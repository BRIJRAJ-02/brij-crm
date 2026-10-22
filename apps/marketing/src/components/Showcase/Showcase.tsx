import { TabPanel, Tabs } from '@crm/ui';
import { useState } from 'react';
import { SHOWCASE } from '../../showcase.ts';
import { Slides } from '../Slides/Slides.tsx';
import styles from './Showcase.module.css';

/**
 * The product's four areas as the library's feature tabs under the window where the chosen one's screens play,
 * whole, fading out at the foot (the owner, 23 October 2026: the tabs below, no descriptions, nothing cut). The
 * first area’s first screen is in the page from the start; the rest load as they are picked.
 */
export function Showcase() {
  const [selected, setSelected] = useState<string>(SHOWCASE[0]?.id ?? 'crm');
  // After an area’s last screen, the next area (the owner, 23 October 2026: four seconds a screen, then the tab).
  const moveOn = () => {
    const index = SHOWCASE.findIndex((area) => area.id === selected);
    setSelected(SHOWCASE[(index + 1) % SHOWCASE.length]?.id ?? selected);
  };
  return (
    <div className={styles.root}>
      <Tabs
        label="What Timefix does"
        variant="feature"
        placement="bottom"
        tabs={SHOWCASE.map((area) => ({
          id: area.id,
          label: area.label,
          icon: area.icon,
          hue: area.hue,
        }))}
        selectedKey={selected}
        onSelectionChange={setSelected}
      >
        {SHOWCASE.map((area, index) => (
          <TabPanel id={area.id} key={area.id} variant="fill">
            <div className={styles.fit}>
              <Slides area={area} isFirst={index === 0} onEnd={moveOn} />
            </div>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
