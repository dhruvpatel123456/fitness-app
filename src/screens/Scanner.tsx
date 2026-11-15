// Barcode scanner: a full-screen view from the rear camera.
//
//  * Uses the phone's built-in barcode reader (BarcodeDetector) where it
//    exists, and the ZXing library otherwise (iPhone Safari needs ZXing).
//  * Cameras only work on secure pages (https, or localhost). On a plain
//    http address the camera is hidden, the reason is explained, and the
//    barcode can still be typed in. Nothing crashes.

import { Flashlight, FlashlightOff, Keyboard, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Spinner, cx } from '../components/ui';
import { errorMessage } from '../lib/api';
import { meal_for_now } from '../lib/app';
import { useLayer, useNav } from '../lib/nav';
import { lookupBarcode } from '../lib/queries';
import type { Food } from '../types';
import { FoodDetail } from './FoodDetail';
import { FoodForm } from './FoodForm';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'code_128'];

type DetectorLike = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorCtor = { new (options: { formats: string[] }): DetectorLike; getSupportedFormats?: () => Promise<string[]> };

type Phase =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'no-camera'; reason: ReactNode }
  | { kind: 'looking'; code: string }
  | { kind: 'problem'; code: string; message: string };

function cleanCode(text: string): string | null {
  const digits = text.replace(/\s+/g, '');
  return /^\d{6,14}$/.test(digits) ? digits : null;
}

function cameraProblem(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow the camera for this site in your browser settings, then reopen the scanner.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'The camera could not be started.';
}

export function Scanner({ onFound, onCreate }: { onFound: (food: Food) => void; onCreate: (barcode: string) => void }) {
  const nav = useNav();
  const { index } = useLayer();
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const handling = useRef(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' });
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const secure = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

  const lookUp = useCallback(
    async (code: string) => {
      handling.current = true;
      setPhase({ kind: 'looking', code });
      try {
        const result = await lookupBarcode(code);
        if (result.status === 'found') {
          onFound(result.food);
          return;
        }
        if (result.status === 'not_found') {
          onCreate(code);
          return;
        }
        const why =
          result.reason === 'timeout'
            ? 'The online food database took too long to answer.'
            : result.reason === 'offline'
              ? 'The laptop could not reach the online food database.'
              : result.reason === 'rate_limited'
                ? 'Too many lookups in a row. Wait a moment.'
                : 'The online food database had a problem.';
        setPhase({ kind: 'problem', code, message: `${why} This barcode is not in your own foods yet.` });
      } catch (err) {
        setPhase({ kind: 'problem', code, message: errorMessage(err) });
      }
    },
    [onCreate, onFound],
  );

  const resume = () => {
    handling.current = false;
    setPhase(secure && track.current ? { kind: 'scanning' } : { kind: 'no-camera', reason: null });
  };

  // Start the camera and the barcode reader; stop both when the screen closes.
  useEffect(() => {
    if (!secure) {
      setPhase({
        kind: 'no-camera',
        reason: (
          <>
            The camera only works on a secure (https) address, and this page was opened over plain http. Open the app through its
            https address (see “Connecting your phone” in the README), or type the barcode below.
          </>
        ),
      });
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let zxingStop: (() => void) | null = null;

    const found = (text: string) => {
      if (stopped || handling.current) return;
      const code = cleanCode(text);
      if (!code) return;
      try {
        navigator.vibrate?.(80);
      } catch {
        // Vibration is optional (iPhones do not support it).
      }
      void lookUp(code);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        if (!stopped) setPhase({ kind: 'no-camera', reason: cameraProblem(err) });
        return;
      }
      if (stopped || !video.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const el = video.current;
      el.srcObject = stream;
      try {
        await el.play();
      } catch {
        // Autoplay can be refused; the stream usually still starts when it is ready.
      }
      track.current = stream.getVideoTracks()[0] ?? null;
      const caps = (track.current?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchAvailable(Boolean(caps.torch));
      setPhase({ kind: 'scanning' });

      // 1. The built-in reader, where the browser has one for these barcode types.
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
      if (Native) {
        try {
          const supported = Native.getSupportedFormats ? await Native.getSupportedFormats() : FORMATS;
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length > 0) {
            const detector = new Native({ formats });
            const tick = async () => {
              if (stopped) return;
              if (!handling.current && el.readyState >= 2) {
                try {
                  const codes = await detector.detect(el);
                  if (codes.length > 0) found(codes[0].rawValue);
                } catch {
                  // A frame that could not be read; try the next one.
                }
              }
              timer = window.setTimeout(tick, 160);
            };
            void tick();
            return;
          }
        } catch {
          // Fall through to ZXing.
        }
      }

      // 2. ZXing (loaded only when needed).
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ]);
        if (stopped) return;
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.ITF,
          BarcodeFormat.CODE_128,
        ]);
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 600 });
        const controls = await reader.decodeFromVideoElement(el, (result) => {
          if (result) found(result.getText());
        });
        zxingStop = () => controls.stop();
        if (stopped) controls.stop();
      } catch {
        if (!stopped) {
          setPhase({ kind: 'no-camera', reason: 'The barcode reader could not be loaded. You can type the barcode below.' });
        }
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      try {
        zxingStop?.();
      } catch {
        // Already stopped.
      }
      stream?.getTracks().forEach((t) => t.stop());
      track.current = null;
    };
  }, [lookUp, secure]);

  const toggleTorch = async () => {
    const next = !torchOn;
    try {
      await track.current?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const code = cleanCode(manual);
    if (!code) {
      setManualError('A barcode is 6 to 14 digits.');
      return;
    }
    setManualError(null);
    void lookUp(code);
  };

  const cameraLive = secure && phase.kind !== 'no-camera';

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-white" style={{ zIndex: 30 + index }} role="dialog" aria-modal="true" aria-label="Scan a barcode">
      {cameraLive && <video ref={video} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-cover" />}

      <div className="pt-safe px-safe relative z-10 flex items-center justify-between p-2">
        <button type="button" aria-label="Close scanner" onClick={() => nav.pop()} className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50">
          <X size={26} />
        </button>
        {cameraLive && torchAvailable && (
          <button
            type="button"
            aria-label={torchOn ? 'Turn the torch off' : 'Turn the torch on'}
            aria-pressed={torchOn}
            onClick={() => void toggleTorch()}
            className={cx('flex h-12 w-12 items-center justify-center rounded-full', torchOn ? 'bg-white text-black' : 'bg-black/50')}
          >
            {torchOn ? <Flashlight size={24} /> : <FlashlightOff size={24} />}
          </button>
        )}
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-8">
        {phase.kind === 'starting' && <Spinner size={32} className="text-white" />}
        {phase.kind === 'scanning' && (
          <div className="w-full max-w-sm">
            <div className="aspect-[5/3] w-full rounded-2xl border-2 border-white/90 shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]" />
            <p className="mt-4 text-center text-[15px] font-medium drop-shadow">Hold the barcode inside the frame</p>
          </div>
        )}
        {phase.kind === 'looking' && (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/70 px-6 py-5">
            <Spinner size={30} className="text-white" />
            <p className="tabular text-[15px]">Looking up {phase.code}…</p>
          </div>
        )}
        {phase.kind === 'problem' && (
          <div className="w-full max-w-sm rounded-2xl bg-black/80 p-5 text-center">
            <p className="text-[15px] leading-snug">{phase.message}</p>
            <div className="mt-4 flex flex-col gap-2">
              <Button onClick={() => void lookUp(phase.code)}>Try again</Button>
              <Button variant="secondary" onClick={() => onCreate(phase.code)}>
                Create this food myself
              </Button>
              <Button variant="ghost" className="text-white" onClick={resume}>
                Scan something else
              </Button>
            </div>
          </div>
        )}
        {phase.kind === 'no-camera' && (
          <div className="w-full max-w-sm rounded-2xl bg-white/10 p-5 text-center">
            <Keyboard size={30} className="mx-auto" aria-hidden />
            <p className="mt-3 text-[15px] leading-snug">{phase.reason ?? 'Type the barcode number below.'}</p>
          </div>
        )}
      </div>

      <form onSubmit={submitManual} className="pb-safe px-safe relative z-10 bg-black/75" noValidate>
        <div className="mx-auto flex max-w-sm items-start gap-2 p-3">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Barcode number</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Or type the barcode number"
              value={manual}
              onChange={(e) => setManual(e.target.value.replace(/[^\d\s]/g, ''))}
              className="h-12 w-full rounded-xl border border-white/30 bg-white/10 px-3 text-white placeholder:text-white/60 focus:border-white focus:outline-none"
            />
            {manualError && (
              <span className="mt-1 block text-[13px] font-medium text-[#ffb59a]" role="alert">
                {manualError}
              </span>
            )}
          </label>
          <Button type="submit" disabled={phase.kind === 'looking'}>
            Look up
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Open the scanner straight from the home-screen shortcut. */
export function openScanner(nav: ReturnType<typeof useNav>, { date, meal = meal_for_now() }: { date: string; meal?: number }) {
  nav.push(
    <Scanner
      onFound={(food) => nav.replace(<FoodDetail food={food} date={date} meal={meal} />)}
      onCreate={(barcode) =>
        nav.replace(<FoodForm barcode={barcode} onSaved={(food) => nav.replace(<FoodDetail food={food} date={date} meal={meal} />)} />)
      }
    />,
  );
}
