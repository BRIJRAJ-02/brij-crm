import type { FormStrings } from '@crm/contracts/forms';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../atoms/Button/Button.tsx';
import { VisuallyHidden } from '../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { Field } from '../molecules/Field/Field.tsx';
import { FieldGroup } from '../molecules/FieldGroup/FieldGroup.tsx';
import { isUploadedFile, type HostedFileHandlers, type HostedUploadedFile } from './files.ts';
import styles from './SignatureQuestion.module.css';

/** Props for SignatureQuestion. */
export interface SignatureQuestionProps {
  /** The question's key: what the form marks busy while the drawing goes. */
  readonly questionKey: string;
  /** The question's label, with its "(optional)" aside when it has one. */
  readonly label: string;
  readonly words: FormStrings;
  /** The signature held as the answer, once its picture is in. */
  readonly value: unknown;
  readonly error: string | undefined;
  /** Absent (the builder's preview, a page with nowhere to send): the pad is drawn and disabled. */
  readonly files: HostedFileHandlers | undefined;
  readonly onChange: (value: HostedUploadedFile | undefined) => void;
}

/** One stroke: its points across the pad, each from 0 to 1 of its width and height. */
type Stroke = readonly (readonly [number, number])[];

/** The picture kept: three times as wide as tall, as the pad is drawn, large enough to print. */
const OUT = { width: 900, height: 300 } as const;
/** How long the pad waits after the last stroke or key before it sends the picture. */
const SETTLE_MS = 700;
/**
 * The typed name's script face. System faces only (the hosted page adds no font origin, spec 0063 Security model):
 * Apple's, Windows', then the platform's own cursive.
 */
const SCRIPT_FACE = '"Snell Roundhand", "Segoe Script", "Bradley Hand", "Brush Script MT", cursive';
/**
 * The kept picture is ink on paper, whatever the page's theme, so it reads the same in the CRM's light and dark.
 * These are the picture's own colours, not the interface's, so they are named here rather than taken from tokens.
 */
const PAPER = 'white';
const INK = 'black';

/** Draws the strokes, or the typed name, into a canvas `width` by `height`, in `ink`, on `paper` when given. */
function paint(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  content: { readonly strokes: readonly Stroke[]; readonly typed: string | undefined },
  ink: string,
  paper?: string,
): void {
  const context = canvas.getContext('2d');
  if (context === null) return;
  context.clearRect(0, 0, width, height);
  if (paper !== undefined) {
    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);
  }
  context.strokeStyle = ink;
  context.fillStyle = ink;
  if (content.typed !== undefined) {
    const name = content.typed.trim();
    if (name === '') return;
    // As large as fits: half the height, smaller for a long name.
    let size = height * 0.5;
    context.font = `${String(size)}px ${SCRIPT_FACE}`;
    const room = width * 0.9;
    const measured = context.measureText(name).width;
    if (measured > room) size = (size * room) / measured;
    context.font = `${String(size)}px ${SCRIPT_FACE}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, width / 2, height / 2);
    return;
  }
  context.lineWidth = Math.max(1.5, height / 90);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const stroke of content.strokes) {
    const [first, ...rest] = stroke;
    if (first === undefined) continue;
    context.beginPath();
    context.moveTo(first[0] * width, first[1] * height);
    // A dot (a press with no move) still marks the pad.
    if (rest.length === 0) context.lineTo(first[0] * width + 0.1, first[1] * height);
    // Smoothed through each pair's midpoint, so a quick stroke reads as a line rather than a polygon.
    for (let index = 0; index < rest.length; index += 1) {
      const point = rest[index];
      const next = rest[index + 1];
      if (point === undefined) continue;
      if (next === undefined) context.lineTo(point[0] * width, point[1] * height);
      else
        context.quadraticCurveTo(
          point[0] * width,
          point[1] * height,
          ((point[0] + next[0]) / 2) * width,
          ((point[1] + next[1]) / 2) * height,
        );
    }
    context.stroke();
  }
}

/** The PNG of the strokes or the typed name, ink on paper, ready to send. */
async function pictureOf(content: {
  readonly strokes: readonly Stroke[];
  readonly typed: string | undefined;
}): Promise<File | undefined> {
  const canvas = document.createElement('canvas');
  canvas.width = OUT.width;
  canvas.height = OUT.height;
  paint(canvas, OUT.width, OUT.height, content, INK, PAPER);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  return blob === null ? undefined : new File([blob], 'signature.png', { type: 'image/png' });
}

/**
 * A hosted form's Signature question (spec 0063, AC-6307, AC-6308): a pad drawn on with a pointer, or a name typed
 * instead and set in a script face, so nobody needs a pointer to sign. What shows is what is kept: a PNG of the ink
 * on paper, sent once the visitor pauses (the form waits for it before going on). Clear starts again.
 */
export function SignatureQuestion({
  questionKey,
  label,
  words,
  value,
  error,
  files,
  onChange,
}: SignatureQuestionProps) {
  const held = isUploadedFile(value) ? value : undefined;
  const [strokes, setStrokes] = useState<readonly Stroke[]>([]);
  const [typed, setTyped] = useState<string | undefined>(undefined);
  const [said, setSaid] = useState('');
  const pad = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<[number, number][] | undefined>(undefined);
  // The newest change: an upload answered after a later change is stale, and is taken back.
  const round = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sent = useRef<string | undefined>(held?.fileId);
  const isDisabled = files === undefined;
  const isTyping = typed !== undefined;
  const isEmpty = isTyping ? typed.trim() === '' : strokes.length === 0;

  // The pad draws in the page's own text colour, at the screen's density, again whenever its size changes.
  useEffect(() => {
    const canvas = pad.current;
    if (canvas === null) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth * ratio;
      const height = canvas.clientHeight * ratio;
      if (canvas.width !== Math.round(width)) canvas.width = Math.round(width);
      if (canvas.height !== Math.round(height)) canvas.height = Math.round(height);
      paint(canvas, canvas.width, canvas.height, { strokes, typed }, getComputedStyle(canvas).color);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [strokes, typed]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  /** Holds the new content and sends its picture once the visitor pauses; nothing is held meanwhile. */
  const changed = (next: { readonly strokes: readonly Stroke[]; readonly typed: string | undefined }) => {
    if (files === undefined) return;
    round.current += 1;
    const mine = round.current;
    clearTimeout(timer.current);
    onChange(undefined);
    const empty = next.typed === undefined ? next.strokes.length === 0 : next.typed.trim() === '';
    const previous = sent.current;
    if (previous !== undefined) {
      sent.current = undefined;
      void files.remove(previous);
    }
    if (empty) {
      files.setBusy(questionKey, false);
      return;
    }
    files.setBusy(questionKey, true);
    timer.current = setTimeout(() => {
      void (async () => {
        const picture = await pictureOf(next);
        if (mine !== round.current) return;
        if (picture === undefined) {
          files.setBusy(questionKey, false);
          setSaid(words.fileFailed);
          return;
        }
        const outcome = await files.upload(picture, () => undefined);
        if (mine !== round.current) {
          // Drawn on again while it went: this picture is no longer the signature.
          if (outcome.kind === 'done') void files.remove(outcome.file.fileId);
          return;
        }
        files.setBusy(questionKey, false);
        if (outcome.kind === 'done') {
          sent.current = outcome.file.fileId;
          onChange(outcome.file);
          return;
        }
        setSaid(
          outcome.kind === 'rejected'
            ? outcome.message
            : outcome.kind === 'limited'
              ? words.tooMany
              : outcome.kind === 'offline'
                ? words.offline
                : words.fileFailed,
        );
      })();
    }, SETTLE_MS);
  };

  const pointAt = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / Math.max(1, box.width);
    const y = (event.clientY - box.top) / Math.max(1, box.height);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  return (
    <FieldGroup
      label={label}
      {...(error === undefined ? {} : { error })}
      {...(isDisabled ? { hint: words.signaturePreview } : {})}
    >
      <div className={styles.root} data-question-signature={questionKey}>
        {isTyping && (
          <Field
            label={words.typedName}
            name={`${questionKey}.typed`}
            value={typed}
            maxLength={80}
            autoComplete="name"
            isDisabled={isDisabled}
            // Switching to typing puts focus in the box, so a keyboard or screen reader carries straight on.
            autoFocus={typed === ''}
            onChange={(next) => {
              setTyped(next);
              changed({ strokes: [], typed: next });
            }}
          />
        )}
        <div className={styles.padBox}>
          <canvas
            ref={pad}
            className={styles.pad}
            data-typed={isTyping || undefined}
            data-disabled={isDisabled || undefined}
            role="img"
            aria-label={isTyping ? typed.trim() || words.signHere : words.signHere}
            onPointerDown={(event) => {
              if (isDisabled || isTyping || event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drawing.current = [pointAt(event)];
              setStrokes((current) => [...current, drawing.current ?? []]);
            }}
            onPointerMove={(event) => {
              const stroke = drawing.current;
              if (stroke === undefined) return;
              stroke.push(pointAt(event));
              setStrokes((current) => [...current.slice(0, -1), [...stroke]]);
            }}
            onPointerUp={() => {
              const stroke = drawing.current;
              if (stroke === undefined) return;
              drawing.current = undefined;
              const next = [...strokes.slice(0, -1), [...stroke]];
              setStrokes(next);
              changed({ strokes: next, typed: undefined });
            }}
            onPointerCancel={() => {
              drawing.current = undefined;
            }}
          />
          {isEmpty && !isTyping && (
            <span className={styles.placeholder} aria-hidden="true">
              {words.signPlaceholder}
            </span>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            variant="link"
            isDisabled={isDisabled}
            onPress={() => {
              const next = isTyping ? undefined : '';
              setTyped(next);
              setStrokes([]);
              changed({ strokes: [], typed: next });
            }}
          >
            {isTyping ? words.drawInstead : words.typeInstead}
          </Button>
          {!isEmpty && (
            <Button
              variant="link"
              isDisabled={isDisabled}
              onPress={() => {
                setStrokes([]);
                if (isTyping) setTyped('');
                changed({ strokes: [], typed: isTyping ? '' : undefined });
              }}
            >
              {words.clearSignature}
            </Button>
          )}
        </div>
      </div>
      <VisuallyHidden>
        <span aria-live="polite">{said}</span>
      </VisuallyHidden>
    </FieldGroup>
  );
}
