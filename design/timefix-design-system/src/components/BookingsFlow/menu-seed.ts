// Olive Kitchen's menus: Lunch, Dinner and Drinks, with dishes shared between them (the burrata is on Lunch and Dinner), add-ons, sizes and drawn plates.
import type { Diet, Menu, MenuAddOn, MenuDish } from '../MenuPage/MenuPage.tsx';

/** A drawn plate seen from above: the plate, the food in two colours, a garnish. No uploads in the prototype. */
export function plate(food: string, side: string, ground = '#efe6d8'): string {
  const art = `<rect width="400" height="400" fill="${ground}"/><circle cx="200" cy="200" r="160" fill="#fbf8f3"/><circle cx="200" cy="200" r="128" fill="#f3eee6"/>`
    + `<ellipse cx="185" cy="205" rx="82" ry="64" fill="${food}"/><circle cx="245" cy="170" r="34" fill="${side}"/><circle cx="150" cy="160" r="10" fill="#6f8b5d"/><circle cx="230" cy="250" r="8" fill="#6f8b5d"/><circle cx="170" cy="245" r="6" fill="#fff6e0"/>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${art}</svg>`)}`;
}
/** A drawn glass on a table, for drinks. */
export function glass(drink: string, ground = '#e9e1d4'): string {
  const art = `<rect width="400" height="400" fill="${ground}"/><rect y="290" width="400" height="110" fill="#c9b49a"/><path d="M140 110h120l-18 150a42 42 0 0 1-84 0z" fill="#ffffff" fill-opacity=".7"/><path d="M150 170h100l-11 90a39 39 0 0 1-78 0z" fill="${drink}"/><rect x="194" y="290" width="12" height="40" fill="#ffffff" fill-opacity=".8"/><circle cx="246" cy="150" r="16" fill="#e7c95b"/>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${art}</svg>`)}`;
}

/** Olive's dishes, add-ons and three menus. */
export function oliveMenus(): { readonly menus: ReadonlyArray<Menu>; readonly dishes: ReadonlyArray<MenuDish>; readonly addOns: ReadonlyArray<MenuAddOn> } {
  const a = (...names: ReadonlyArray<string>) => names.map((n) => (n.startsWith('~') ? { name: n.slice(1), may: true } : { name: n }));
  const d = (id: string, name: string, price: number | undefined, diet: ReadonlyArray<Diet>, allergens: ReadonlyArray<{ readonly name: string; readonly may?: boolean }>, x: Partial<MenuDish> = {}): MenuDish =>
    ({ id, name, price, diet, allergens, addOnIds: [], ...x });
  const dishes: MenuDish[] = [
    d('burrata', 'Burrata, heirloom tomatoes', 780, ['vegetarian', 'gluten-free'], a('Milk'), { description: 'Basil oil, sea salt, grilled sourdough on the side', popular: true, photo: plate('#f5efe3', '#d9533b'), calories: 540 }),
    d('flatbread', 'Wood-fired flatbread', 420, ['vegan'], a('Gluten', 'Sesame'), { description: 'Za’atar, olive oil, flaky salt', photo: plate('#d8a96a', '#7a8a4a') }),
    d('calamari', 'Crispy calamari', 690, [], a('Molluscs', 'Gluten', 'Eggs'), { description: 'Lemon aioli, pickled chilli', photo: plate('#e2b867', '#f2e7c9') }),
    d('hummus', 'Hummus, warm pita', 450, ['vegan'], a('Sesame', 'Gluten'), { description: 'Chickpeas, tahini, smoked paprika oil', photo: plate('#e7d2a6', '#c46b3c'), addOnIds: ['a-bread'] }),
    d('halloumi', 'Charred halloumi', 620, ['vegetarian', 'gluten-free'], a('Milk'), { description: 'Hot honey, mint, pomegranate', photo: plate('#f0d9a8', '#b32e3c') }),
    d('octopus', 'Wood-fired octopus', 1250, ['gluten-free', 'dairy-free'], a('Molluscs'), { description: 'Smoked paprika, crushed potatoes, lemon', popular: true, photo: plate('#b5523a', '#e9d39c'), calories: 610 }),
    d('lamb', 'Lamb shoulder for two', 2400, ['gluten-free', 'halal'], a('Mustard', '~Milk'), { description: 'Slow roasted for eight hours, salsa verde, flatbread', photo: plate('#7a4a32', '#6f8b5d'), addOnIds: ['a-sides'], calories: 1480 }),
    d('seabass', 'Whole sea bass', undefined, ['gluten-free', 'dairy-free'], a('Fish'), { description: 'Grilled over olive wood, herb salad', priceNote: 'Market price', photo: plate('#c9c1b4', '#9fb36a') }),
    d('shish', 'Chicken shish', 980, ['halal', 'spicy-1'], a('Milk', 'Mustard'), { description: 'Yoghurt and chilli marinade, garlic sauce', photo: plate('#d48a43', '#f3eee6'), addOnIds: ['a-sides'] }),
    d('orzo', 'Wild mushroom orzo', 920, ['vegetarian'], a('Gluten', 'Milk', 'Celery'), { description: 'Parmesan, thyme, truffle oil', photo: plate('#cfb58b', '#5c4a3a'), addOnIds: ['a-protein'] }),
    d('linguine', 'Prawn linguine', 1180, ['spicy-2'], a('Crustaceans', 'Gluten', 'Eggs'), { description: 'Chilli, garlic, cherry tomatoes, lemon', photo: plate('#e6c27a', '#e0674a') }),
    d('mezze', 'Mezze plate', 890, ['vegetarian'], a('Sesame', 'Milk', 'Gluten'), { description: 'Hummus, labneh, falafel, pickles, pita', popular: true, photo: plate('#e7d2a6', '#8a9a4a') }),
    d('cake', 'Olive oil cake', 480, ['vegetarian'], a('Gluten', 'Eggs', 'Milk'), { description: 'Orange, mascarpone', photo: plate('#e8c068', '#f7f1e6') }),
    d('baklava', 'Pistachio baklava', 420, ['vegetarian', 'nuts'], a('Tree nuts', 'Gluten', 'Milk', '~Peanuts'), { description: 'Honey syrup, rose', photo: plate('#c99a4c', '#8fae5a') }),
    d('sorbet', 'Lemon sorbet', 350, ['vegan', 'gluten-free'], [], { description: 'Two scoops', soldOut: true, photo: plate('#f4ec9c', '#f4ec9c') }),
    d('negroni', 'Negroni', 750, ['vegan'], [], { description: 'Gin, Campari, sweet vermouth', photo: glass('#b8312f') }),
    d('spritz', 'Garden spritz', 650, ['vegan'], a('Sulphites'), { description: 'Elderflower, prosecco, cucumber', popular: true, photo: glass('#e9d98a') }),
    d('red', 'House red', undefined, ['vegan'], a('Sulphites'), { description: 'Nashik Shiraz, soft and peppery', sizes: [{ name: 'Glass', price: 600 }, { name: 'Carafe', price: 1600 }, { name: 'Bottle', price: 2900 }], photo: glass('#5e1a24') }),
    d('white', 'House white', undefined, ['vegan'], a('Sulphites'), { description: 'Sauvignon blanc, crisp and citrus', sizes: [{ name: 'Glass', price: 580 }, { name: 'Carafe', price: 1500 }, { name: 'Bottle', price: 2700 }], photo: glass('#efe2a2') }),
    d('soda', 'Fresh lime soda', 220, ['vegan'], [], { addOnIds: ['a-soda'], photo: glass('#d8ecb0') }),
    d('coldbrew', 'Cold brew', 280, ['vegan'], [], { description: 'Sixteen-hour brew, on ice', photo: glass('#4a2f22') }),
  ];
  const addOns: MenuAddOn[] = [
    { id: 'a-sides', name: 'Sides', min: 0, max: 2, options: [{ name: 'Roast potatoes', price: 240 }, { name: 'Greek salad', price: 280 }, { name: 'Fries', price: 250 }] },
    { id: 'a-protein', name: 'Add protein', min: 0, max: 1, options: [{ name: 'Chicken', price: 220 }, { name: 'Prawns', price: 320 }] },
    { id: 'a-soda', name: 'Sweet or salted', min: 1, max: 1, options: [{ name: 'Sweet', price: 0 }, { name: 'Salted', price: 0 }, { name: 'Mixed', price: 0 }] },
    { id: 'a-bread', name: 'Extra bread', min: 0, max: 1, options: [{ name: 'Another pita', price: 80 }] },
  ];
  const s = (id: string, name: string, dishIds: ReadonlyArray<string>, layout: 'list' | 'grid' = 'list', description?: string) => ({ id, name, dishIds, layout, description });
  const menus: Menu[] = [
    { id: 'mn-lunch', name: 'Lunch', isLive: true, serving: { start: 12 * 60, end: 16 * 60 }, tax: 5, service: 10, note: 'Our kitchen uses nuts and sesame.',
      sections: [s('l-plates', 'To share', ['mezze', 'burrata', 'hummus', 'flatbread']), s('l-mains', 'Mains', ['shish', 'orzo']), s('l-sweet', 'Something sweet', ['cake', 'sorbet'])] },
    { id: 'mn-dinner', name: 'Dinner', isLive: true, serving: { start: 19 * 60, end: 23 * 60 }, tax: 5, service: 10, note: 'Our kitchen uses nuts and sesame.',
      sections: [
        s('d-small', 'Small plates', ['burrata', 'flatbread', 'calamari', 'hummus', 'halloumi']),
        s('d-fire', 'From the wood fire', ['octopus', 'lamb', 'seabass', 'shish'], 'grid', 'Cooked over olive wood'),
        s('d-pasta', 'Pasta', ['orzo', 'linguine']),
        s('d-dessert', 'Desserts', ['cake', 'baklava', 'sorbet']),
      ] },
    { id: 'mn-drinks', name: 'Drinks', isLive: true, tax: 5, service: 10,
      sections: [s('k-cocktails', 'Cocktails', ['negroni', 'spritz'], 'grid'), s('k-wine', 'Wine', ['red', 'white']), s('k-soft', 'Soft drinks', ['soda', 'coldbrew'])] },
  ];
  return { menus, dishes, addOns };
}
