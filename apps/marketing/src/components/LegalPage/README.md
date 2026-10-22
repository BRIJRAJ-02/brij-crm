# LegalPage

The privacy policy's and the terms' page: a title, when it last changed, and sections at a reading measure.

## Why it exists

The owner asked for the existing privacy and terms pages on the new site (23 October 2026). Their text is ported as is from the old Timefix site (`timefixmarketing`, where `LegalShell`, `LegalH2`, `LegalP` and `LegalUl` drew it), and Google's OAuth verification reads the privacy page, so it must stay at `/privacy`. The library has no long form reading layout: Card and SettingsLayout are app surfaces.

## Use

```tsx
<LegalPage title="Privacy Policy" updated="15 August 2026">
  <LegalHeading>What we collect</LegalHeading>
  <LegalParagraph>…</LegalParagraph>
  <LegalList>
    <li>…</li>
  </LegalList>
</LegalPage>
```

## States

Static text. Links inside it are the library's `Link`, or plain anchors for addresses on this site.
