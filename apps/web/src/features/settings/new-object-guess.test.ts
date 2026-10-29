import { describe, expect, it } from 'vitest';
import {
  hueFor,
  iconFor,
  looksPlural,
  namesFrom,
  pluralOf,
  singularOf,
  startersFor,
  typeFor,
} from './new-object-guess.ts';

describe('new object guesses', () => {
  it('pluralises a name', () => {
    expect(pluralOf('Project')).toBe('Projects');
    expect(pluralOf('Company')).toBe('Companies');
    expect(pluralOf('Day')).toBe('Days');
    expect(pluralOf('Box')).toBe('Boxes');
    expect(pluralOf('  ')).toBe('');
  });
  it('guesses an icon and a free colour', () => {
    expect(iconFor('Invoice')).toBe('receipt');
    expect(iconFor('Zebra')).toBe('box');
    expect(hueFor('Projects', ['gray', 'red', 'blue'], ['red'])).not.toBe('red');
    expect(hueFor('Projects', ['gray', 'red', 'blue'], [])).not.toBe('gray');
  });
  it('guesses an attribute type from its name', () => {
    expect(typeFor('Email')).toBe('email');
    expect(typeFor('Phone')).toBe('phone');
    expect(typeFor('Website')).toBe('url');
    expect(typeFor('Price')).toBe('currency');
    expect(typeFor('Due date')).toBe('date');
    expect(typeFor('Nickname')).toBe('text');
  });
  it('suggests starters by object', () => {
    expect(startersFor('Project').map((starter) => starter.title)).toContain('Due date');
    expect(startersFor('')).toEqual([]);
  });
});

describe('a plural typed as the name (crm-f7, 28 Oct 2026)', () => {
  // The placeholder offered "Projects", and the object came out "Projectses", its API name fixed for good.
  it('takes it as the plural and guesses the singular, instead of pluralising it again', () => {
    expect(namesFrom('Projects')).toEqual({ singular: 'Project', plural: 'Projects' });
    expect(namesFrom('Graphic Designers')).toEqual({ singular: 'Graphic Designer', plural: 'Graphic Designers' });
    expect(namesFrom('Project')).toEqual({ singular: 'Project', plural: 'Projects' });
  });

  it('guesses the singulars a CRM is full of', () => {
    expect(singularOf('Companies')).toBe('Company');
    expect(singularOf('Boxes')).toBe('Box');
    expect(singularOf('Matches')).toBe('Match');
    expect(singularOf('Addresses')).toBe('Address');
    expect(singularOf('Statuses')).toBe('Status');
    expect(singularOf('Cases')).toBe('Case');
    expect(singularOf('Houses')).toBe('House');
    expect(singularOf('Warehouses')).toBe('Warehouse');
    expect(singularOf('Campuses')).toBe('Campus');
    expect(singularOf('Licenses')).toBe('License');
    expect(singularOf('Movies')).toBe('Movie');
    expect(singularOf('Days')).toBe('Day');
    expect(singularOf('KPIs')).toBe('KPI');
    // A word ending -ties, -pies is a -y word: only a whole -ie word keeps its e (review, 28 Oct 2026).
    expect(singularOf('Opportunities')).toBe('Opportunity');
    expect(singularOf('Properties')).toBe('Property');
    expect(singularOf('Activities')).toBe('Activity');
    expect(singularOf('Abuses')).toBe('Abuse');
    expect(singularOf('Menus')).toBe('Menu');
    expect(singularOf('Emojis')).toBe('Emoji');
    expect(singularOf('Sales')).toBe('Sale');
  });

  it('leaves words the same in both forms alone, either way round', () => {
    for (const name of ['Series', 'News', 'Analytics', 'Lens', 'Canvas', 'Atlas']) {
      expect(namesFrom(name)).toEqual({ singular: name, plural: name });
    }
  });

  it('gives an acronym a small s, as a plural acronym is read back', () => {
    expect(pluralOf('API')).toBe('APIs');
    expect(namesFrom('APIs')).toEqual({ singular: 'API', plural: 'APIs' });
  });

  it('leaves singulars that end in s alone', () => {
    for (const name of ['Address', 'Status', 'Analysis', 'Business', 'Campus', 'Bus']) {
      expect(looksPlural(name)).toBe(false);
      expect(namesFrom(name).singular).toBe(name);
    }
  });
});
