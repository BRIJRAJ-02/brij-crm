import { useRef, type ReactNode } from 'react';
import { Code2, Copy, Download, Mail, MessageCircle, Share2 } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { QrCode, downloadQr } from '../QrCode/QrCode.tsx';
import { useToast } from '../Toast/Toast.tsx';
import './ShareSheet.css';

const i14 = { size: 14, strokeWidth: 1.75 } as const;

/** Props for ShareSheet. */
export interface ShareSheetProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  /** The heading: "Share Discovery call", or after a first publish "Talk to sales is live". */
  readonly title: string;
  readonly description?: string;
  /** The public address without https:// ("timefix.com/priya/discovery-call"). */
  readonly url: string;
  /** What is being shared, for the QR code's name, the email's subject and the file names. */
  readonly name: string;
  /** "Put it on your site": shown where the thing embeds (forms, booking pages, the link page, menus). */
  readonly onSite?: () => void;
  /** Words written before the link in Email and WhatsApp ("Pick a time that suits you:"). */
  readonly invite?: string;
  /** More ways that belong to this thing (Offer specific times, One-time link, Add to link page), as Buttons. */
  readonly extra?: ReactNode;
  /** One quiet line at the foot ("Answers go to People · Change"). */
  readonly footer?: ReactNode;
}

/**
 * The one share dialog: the link with Copy, Email, WhatsApp and More, the QR code with PNG and SVG, and "Put it on your site" where the
 * thing embeds. Every Share button opens it, and so does a first publish. Copy says honestly whether it worked.
 */
export function ShareSheet({ isOpen, onOpenChange, title, description = 'Send the link, put it on your site, or print the code.', url, name, onSite, invite, extra, footer }: ShareSheetProps) {
  const { toast } = useToast();
  const svg = useRef<SVGSVGElement>(null);
  const full = `https://${url}`;
  const text = invite ? `${invite} ${full}` : full;
  const copy = () => { void navigator.clipboard.writeText(full).then(() => toast({ message: 'Link copied', tone: 'success' }), () => toast({ message: `Copy didn’t work. The link is ${url}`, tone: 'danger' })); };
  const more = () => { const nav = navigator as Navigator & { share?: (d: { title: string; url: string }) => Promise<void> }; if (nav.share) void nav.share({ title: name, url: full }).catch(() => undefined); else copy(); };
  const save = (format: 'png' | 'svg') => { if (svg.current) void downloadQr(svg.current, url.replace(/[^a-z0-9]+/gi, '-'), format).then((o) => { if (o === 'saved') toast({ message: `QR code saved as ${format.toUpperCase()}`, tone: 'success' }); }); };
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title={title} description={description} actions={<Button variant="primary" slot="close">Done</Button>}>
      <div className="tf-share">
        <div className="tf-share__link"><span className="tf-share__url tf-num">{url}</span><Button size="sm" variant="secondary" icon={<Copy {...i14} />} onPress={copy}>Copy</Button></div>
        <div className="tf-share__send" role="group" aria-label="Send the link">
          <Button size="sm" variant="ghost" icon={<Mail {...i14} />} onPress={() => window.open(`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(text)}`, '_blank', 'noopener')}>Email</Button>
          <Button size="sm" variant="ghost" icon={<MessageCircle {...i14} />} onPress={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>WhatsApp</Button>
          <Button size="sm" variant="ghost" icon={<Share2 {...i14} />} onPress={more}>More</Button>
        </div>
        <div className="tf-share__qr">
          <QrCode value={full} label={`QR code for ${name}`} size="sm" withLogo ref={svg} />
          <span className="tf-share__qrbtns"><span className="tf-share__muted">For a card, a table, a poster or a slide.</span>
            <span className="tf-share__row"><Button size="sm" variant="secondary" icon={<Download {...i14} />} onPress={() => save('png')}>PNG</Button><Button size="sm" variant="ghost" icon={<Download {...i14} />} onPress={() => save('svg')}>SVG</Button></span></span>
        </div>
        {onSite && <Button variant="secondary" icon={<Code2 {...i14} />} onPress={onSite}>Put it on your site</Button>}
        {extra && <div className="tf-share__extra" role="group" aria-label="More ways to share">{extra}</div>}
        {footer && <p className="tf-share__foot">{footer}</p>}
      </div>
    </Dialog>
  );
}
