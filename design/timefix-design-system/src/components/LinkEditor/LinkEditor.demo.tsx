import { demoBlocks, demoBooking, demoProfile, demoSocials } from '../LinkPage/LinkPage.demo.tsx';
import { LinkEditor } from './LinkEditor.tsx';

export function LinkEditorDemo() {
  return (
    <div className="tf-demo tf-demo--canvas">
      <LinkEditor
        live={{ profile: demoProfile, socials: demoSocials, blocks: demoBlocks, look: 'calm', accent: '#0F766E' }}
        booking={demoBooking}
        onPublish={() => new Promise((resolve) => { window.setTimeout(resolve, 900); })}
      />
    </div>
  );
}
