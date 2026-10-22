import { TabPanel, Tabs } from '@crm/ui';
import { useState } from 'react';
import { SHOWCASE } from '../../showcase.ts';
import { Slides } from '../Slides/Slides.tsx';
import styles from './Showcase.module.css';

/**
 * The product's four areas as the library's feature tabs, the chosen one's screens playing in a window under
 * them, whole: the window takes the content's full width. The first area's first screen is in the page from the
 * start; the rest load as they are picked.
 */
export function Showcase() {
  const [selected, setSelected] = useState<string>(SHOWCASE[0]?.id ?? 'crm');
  return (
    <div className={styles.root}>
      <Tabs
        label="What Timefix does"
        variant="feature"
        tabs={SHOWCASE.map((area) => ({
          id: area.id,
          label: area.label,
          description: area.description,
          icon: area.icon,
          hue: area.hue,
        }))}
        selectedKey={selected}
        onSelectionChange={setSelected}
      >
        {SHOWCASE.map((area, index) => (
          <TabPanel id={area.id} key={area.id} variant="fill">
            <div className={styles.fit}>
              <Slides area={area} isFirst={index === 0} />
            </div>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
