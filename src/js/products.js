const products = [
  {
    id: 1,
    name: 'Victorian Diamond Ring',
    description: 'Exquisite Victorian-era diamond ring featuring a round-cut diamond set in 18ct gold.',
    price: 2500.00,
    image: '/src/images/products/victorian-diamond-ring.svg',
    category: 'rings',
    condition: 'Excellent',
    era: 'Victorian',
    metal: '18ct Gold',
    stone: 'Diamond',
    year: '1890'
  },
  {
    id: 2,
    name: 'Art Deco Sapphire Pendant',
    description: 'Rare Art Deco pendant with a deep blue sapphire and filigree details.',
    price: 1450.00,
    image: '/src/images/products/art-deco-sapphire-pendant.svg',
    category: 'necklaces',
    condition: 'Very Good',
    era: 'Art Deco',
    metal: 'Platinum',
    stone: 'Sapphire',
    year: '1925'
  }
];

if (typeof module !== 'undefined') module.exports = products;