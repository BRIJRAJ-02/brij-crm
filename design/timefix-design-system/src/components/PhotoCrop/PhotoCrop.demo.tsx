import { useState } from 'react';
import { Button } from '../Button/Button.tsx';
import { CroppedImage, PhotoCrop, type PhotoCropValue, type PhotoShape } from './PhotoCrop.tsx';

// A flat drawn landscape stands in for a photo, so the demo needs no network.
const photo = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<rect width="1200" height="800" fill="#cfe3f2"/><circle cx="880" cy="210" r="90" fill="#f6c453"/>
<path d="M0 520 L260 300 L470 500 L700 260 L1000 520 L1200 380 L1200 800 L0 800 Z" fill="#6b8f71"/>
<path d="M0 620 L320 470 L640 640 L900 520 L1200 640 L1200 800 L0 800 Z" fill="#3f6b4f"/>
<rect x="540" y="560" width="120" height="90" fill="#efe6d8"/><path d="M525 565 L600 505 L675 565 Z" fill="#a8553a"/></svg>`)}`;

export function PhotoCropDemo() {
  const [open, setOpen] = useState<'face' | 'cover' | 'new' | undefined>();
  const [face, setFace] = useState<{ src: string; crop: PhotoCropValue }>({ src: photo, crop: { x: 0.12, y: -0.05, zoom: 1.6, aspect: 1.5, shape: 'round' } });
  const [cover, setCover] = useState<{ src: string; crop: PhotoCropValue }>({ src: photo, crop: { x: 0, y: 0.1, zoom: 1, aspect: 1.5, shape: 'wide' } });
  const keep = (which: 'face' | 'cover') => (src: string, crop: PhotoCropValue) => new Promise<void>((resolve) => {
    window.setTimeout(() => { (which === 'face' ? setFace : setCover)({ src, crop }); resolve(); }, 700);
  });
  const shapeFor: Record<'face' | 'cover', PhotoShape> = { face: 'round', cover: 'wide' };
  return (
    <div className="tf-demo tf-stack">
      <div className="tf-row tf-cropdemo">
        <CroppedImage src={face.src} crop={face.crop} width={64} alt="Priya Raman" />
        <div className="tf-stack tf-cropdemo__actions">
          <span className="tf-row">
            <Button size="sm" onPress={() => setOpen('face')}>Adjust photo</Button>
            <Button size="sm" variant="ghost" onPress={() => setOpen('new')}>Upload new</Button>
          </span>
        </div>
      </div>
      <div className="tf-stack">
        <CroppedImage src={cover.src} crop={cover.crop} width={360} alt="Cover" />
        <span className="tf-row"><Button size="sm" onPress={() => setOpen('cover')}>Adjust cover</Button></span>
      </div>
      <PhotoCrop isOpen={open === 'face' || open === 'cover'} onOpenChange={(o) => { if (!o) setOpen(undefined); }}
        src={open === 'cover' ? cover.src : face.src} initialCrop={open === 'cover' ? cover.crop : face.crop} shape={open === 'cover' ? shapeFor.cover : shapeFor.face}
        title={open === 'cover' ? 'Crop cover' : 'Crop photo'} onSave={keep(open === 'cover' ? 'cover' : 'face')} />
      <PhotoCrop isOpen={open === 'new'} onOpenChange={(o) => { if (!o) setOpen(undefined); }} onSave={(src, crop) => keep(crop.shape === 'wide' ? 'cover' : 'face')(src, crop)} />
    </div>
  );
}
