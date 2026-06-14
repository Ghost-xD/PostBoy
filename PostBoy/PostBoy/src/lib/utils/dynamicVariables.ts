// Common names and words for fake data generation
const FIRST_NAMES = [
  'James', 'John', 'Robert', 'Michael', 'David', 'William', 'Richard', 'Joseph', 'Thomas', 'Christopher',
  'Charles', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua',
  'Kenneth', 'Kevin', 'Brian', 'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan',
  'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen',
  'Nancy', 'Lisa', 'Betty', 'Helen', 'Sandra', 'Donna', 'Carol', 'Ruth', 'Sharon', 'Michelle',
  'Laura', 'Sarah', 'Kimberly', 'Deborah', 'Dorothy', 'Lisa', 'Nancy', 'Karen', 'Betty', 'Helen'
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'
];

const WORDS = [
  'apple', 'banana', 'orange', 'grape', 'cherry', 'lemon', 'mango', 'peach', 'berry', 'melon',
  'computer', 'keyboard', 'monitor', 'mouse', 'speaker', 'camera', 'phone', 'tablet', 'laptop', 'desktop',
  'book', 'pencil', 'paper', 'notebook', 'pen', 'marker', 'eraser', 'ruler', 'folder', 'file',
  'car', 'bike', 'plane', 'train', 'boat', 'truck', 'bus', 'motorcycle', 'scooter', 'helicopter',
  'dog', 'cat', 'bird', 'fish', 'rabbit', 'horse', 'cow', 'pig', 'sheep', 'chicken',
  'red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'brown', 'black', 'white',
  'big', 'small', 'tall', 'short', 'wide', 'narrow', 'thick', 'thin', 'heavy', 'light',
  'fast', 'slow', 'quick', 'smooth', 'rough', 'soft', 'hard', 'warm', 'cold', 'hot'
];

function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

// Dynamic variable generators matching Postman
const DYNAMIC_VARIABLES: Record<string, () => string> = {
  // UUID and identifiers
  '$guid': () => crypto.randomUUID(),
  '$randomUUID': () => crypto.randomUUID(),
  
  // Numbers
  '$randomInt': () => Math.floor(Math.random() * 1000).toString(),
  '$randomFloat': () => (Math.random() * 100).toFixed(2),
  
  // Timestamps  
  '$timestamp': () => Math.floor(Date.now() / 1000).toString(),
  '$isoTimestamp': () => new Date().toISOString(),
  '$unixTimestamp': () => Date.now().toString(),
  
  // Fake data - names
  '$randomFirstName': () => randomChoice(FIRST_NAMES),
  '$randomLastName': () => randomChoice(LAST_NAMES),
  '$randomFullName': () => `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`,
  
  // Fake data - contact
  '$randomEmail': () => `${generateRandomString(8)}@example.com`,
  '$randomUserName': () => generateRandomString(8),
  
  // Fake data - visual
  '$randomColor': () => `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
  '$randomHexColor': () => `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
  
  // Fake data - text
  '$randomWord': () => randomChoice(WORDS),
  '$randomWords': () => Array.from({ length: 3 }, () => randomChoice(WORDS)).join(' '),
  '$randomSentence': () => {
    const words = Array.from({ length: 5 + Math.floor(Math.random() * 5) }, () => randomChoice(WORDS));
    words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return words.join(' ') + '.';
  },
  
  // Fake data - numbers
  '$randomBoolean': () => Math.random() > 0.5 ? 'true' : 'false',
  
  // Fake data - network
  '$randomIP': () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 256)).join('.'),
  '$randomMACAddress': () => Array.from({ length: 6 }, () => 
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':'),
  
  // Fake data - dates
  '$randomDateRecent': () => new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
  '$randomDateFuture': () => new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
  '$randomDatePast': () => new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString(),
  
  // Common Postman variables
  '$randomAlphaNumeric': () => generateRandomString(1),
  '$randomCity': () => randomChoice(['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia']),
  '$randomCountry': () => randomChoice(['United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Japan']),
  '$randomCountryCode': () => randomChoice(['US', 'CA', 'UK', 'DE', 'FR', 'JP']),
  '$randomCurrencyCode': () => randomChoice(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD']),
  '$randomCurrencyName': () => randomChoice(['Dollar', 'Euro', 'Pound', 'Yen', 'Franc', 'Mark']),
  '$randomPhoneNumber': () => `+1-555-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`,
};

export function isDynamicVariable(varName: string): boolean {
  return varName.startsWith('$') && varName in DYNAMIC_VARIABLES;
}

export function generateDynamicVariable(varName: string): string | undefined {
  if (!isDynamicVariable(varName)) {
    return undefined;
  }
  
  try {
    return DYNAMIC_VARIABLES[varName]();
  } catch (error) {
    console.warn(`Failed to generate dynamic variable ${varName}:`, error);
    return undefined;
  }
}

export function getAllDynamicVariableNames(): string[] {
  return Object.keys(DYNAMIC_VARIABLES).sort();
}