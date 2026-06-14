/**
 * Postman-compatible pm.expect() assertion chain.
 */

export interface PmTestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function fmt(val: unknown): string {
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function assertPass(passed: boolean, message: string, negate: boolean): void {
  if (negate ? passed : !passed) fail(message);
}

function assertEqual(actual: unknown, expected: unknown, strict: boolean, negate: boolean): void {
  const match = strict ? actual === expected : JSON.stringify(actual) === JSON.stringify(expected);
  if (negate) {
    if (match) {
      fail(`Expected ${fmt(actual)} not to ${strict ? 'equal' : 'deep equal'} ${fmt(expected)}`);
    }
    return;
  }
  if (!match) fail(`Expected ${fmt(expected)} but got ${fmt(actual)}`);
}

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && !Number.isNaN(v),
  boolean: (v) => typeof v === 'boolean',
  function: (v) => typeof v === 'function',
  undefined: (v) => v === undefined,
  null: (v) => v === null,
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

function assertType(actual: unknown, type: string, negate: boolean): void {
  const article = /^[aeiou]/i.test(type) ? 'an' : 'a';
  const check = TYPE_CHECKS[type.toLowerCase()];
  const passed = check ? check(actual) : typeof actual === type;
  assertPass(
    passed,
    negate
      ? `Expected ${fmt(actual)} not to be ${article} ${type}`
      : `Expected ${fmt(actual)} to be ${article} ${type}`,
    false
  );
}

function assertInclude(actual: unknown, item: unknown, negate: boolean): void {
  let included = false;
  if (typeof actual === 'string' && (typeof item === 'string' || typeof item === 'number')) {
    included = actual.includes(String(item));
  } else if (Array.isArray(actual)) {
    included = actual.some((entry) =>
      typeof entry === 'object' && entry !== null
        ? JSON.stringify(entry) === JSON.stringify(item)
        : entry === item
    );
  } else if (actual && typeof actual === 'object') {
    included = Object.prototype.hasOwnProperty.call(actual, String(item));
  }
  assertPass(
    included,
    negate
      ? `Expected ${fmt(actual)} not to include ${fmt(item)}`
      : `Expected ${fmt(actual)} to include ${fmt(item)}`,
    false
  );
}

function buildBe(actual: unknown, negate: boolean) {
  const num = (label: string, compare: (a: number, b: number) => boolean, expected: number) => {
    if (typeof actual !== 'number' || Number.isNaN(actual)) {
      fail(`Expected ${fmt(actual)} to be ${label} ${expected}`);
    }
    assertPass(
      compare(actual, expected),
      negate
        ? `Expected ${actual} not to be ${label} ${expected}`
        : `Expected ${actual} to be ${label} ${expected}`,
      false
    );
  };

  return {
    ok: () =>
      assertPass(
        !!actual,
        negate ? `Expected ${fmt(actual)} not to be truthy` : `Expected truthy value but got ${fmt(actual)}`,
        false
      ),
    true: () =>
      assertPass(
        actual === true,
        negate ? `Expected ${fmt(actual)} not to be true` : `Expected true but got ${fmt(actual)}`,
        false
      ),
    false: () =>
      assertPass(
        actual === false,
        negate ? `Expected ${fmt(actual)} not to be false` : `Expected false but got ${fmt(actual)}`,
        false
      ),
    null: () =>
      assertPass(
        actual === null,
        negate ? `Expected ${fmt(actual)} not to be null` : `Expected null but got ${fmt(actual)}`,
        false
      ),
    undefined: () =>
      assertPass(
        actual === undefined,
        negate ? `Expected ${fmt(actual)} not to be undefined` : `Expected undefined but got ${fmt(actual)}`,
        false
      ),
    empty: () => {
      const isEmpty =
        actual == null ||
        (typeof actual === 'string' && actual.length === 0) ||
        (Array.isArray(actual) && actual.length === 0) ||
        (typeof actual === 'object' && actual !== null && Object.keys(actual).length === 0);
      assertPass(
        isEmpty,
        negate ? `Expected ${fmt(actual)} not to be empty` : `Expected ${fmt(actual)} to be empty`,
        false
      );
    },
    a: (type: string) => assertType(actual, type, negate),
    an: (type: string) => assertType(actual, type, negate),
    above: (n: number) => num('above', (a, b) => a > b, n),
    below: (n: number) => num('below', (a, b) => a < b, n),
    greaterThan: (n: number) => num('greater than', (a, b) => a > b, n),
    lessThan: (n: number) => num('less than', (a, b) => a < b, n),
    at: {
      least: (n: number) => num('at least', (a, b) => a >= b, n),
      most: (n: number) => num('at most', (a, b) => a <= b, n),
    },
    within: (min: number, max: number) => {
      if (typeof actual !== 'number' || Number.isNaN(actual)) {
        fail(`Expected ${fmt(actual)} to be within ${min}..${max}`);
      }
      const inRange = actual >= min && actual <= max;
      assertPass(
        inRange,
        negate
          ? `Expected ${actual} not to be within ${min}..${max}`
          : `Expected ${actual} to be within ${min}..${max}`,
        false
      );
    },
    oneOf: (list: unknown[]) => {
      const found = list.some((entry) =>
        typeof entry === 'object' && entry !== null
          ? JSON.stringify(entry) === JSON.stringify(actual)
          : entry === actual
      );
      assertPass(
        found,
        negate
          ? `Expected ${fmt(actual)} not to be one of ${fmt(list)}`
          : `Expected ${fmt(actual)} to be one of ${fmt(list)}`,
        false
      );
    },
  };
}

function buildHave(actual: unknown, negate: boolean) {
  return {
    property: (key: string, value?: unknown) => {
      const obj = actual as Record<string, unknown> | null;
      const has = obj != null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
      if (negate) {
        if (has) fail(`Expected object not to have property ${key}`);
        return;
      }
      if (!has) fail(`Expected object to have property ${key}`);
      if (value !== undefined && obj![key] !== value) {
        fail(`Expected property ${key} to equal ${fmt(value)} but got ${fmt(obj![key])}`);
      }
    },
    length: (n: number) => {
      const len =
        actual == null
          ? undefined
          : typeof (actual as { length?: number }).length === 'number'
            ? (actual as { length: number }).length
            : undefined;
      if (len === undefined) fail(`Expected ${fmt(actual)} to have a length`);
      assertPass(
        len === n,
        negate ? `Expected length not to be ${n} but got ${len}` : `Expected length ${n} but got ${len}`,
        false
      );
    },
    keys: (...keys: string[]) => {
      if (!actual || typeof actual !== 'object') fail(`Expected ${fmt(actual)} to be an object`);
      for (const key of keys) {
        const has = Object.prototype.hasOwnProperty.call(actual, key);
        if (negate) {
          if (has) fail(`Expected object not to have key ${key}`);
        } else if (!has) {
          fail(`Expected object to have key ${key}`);
        }
      }
    },
    members: (list: unknown[]) => {
      if (!Array.isArray(actual)) fail(`Expected ${fmt(actual)} to be an array`);
      const match =
        actual.length === list.length &&
        actual.every((entry, i) =>
          typeof entry === 'object' && entry !== null
            ? JSON.stringify(entry) === JSON.stringify(list[i])
            : entry === list[i]
        );
      assertPass(
        match,
        negate
          ? `Expected ${fmt(actual)} not to have members ${fmt(list)}`
          : `Expected ${fmt(actual)} to have members ${fmt(list)}`,
        false
      );
    },
  };
}

function buildTo(actual: unknown, negate: boolean) {
  const chain = {
    equal: (expected: unknown) => assertEqual(actual, expected, true, negate),
    eql: (expected: unknown) => assertEqual(actual, expected, false, negate),
    deep: {
      equal: (expected: unknown) => assertEqual(actual, expected, false, negate),
    },
    include: (item: unknown) => assertInclude(actual, item, negate),
    exist: () =>
      assertPass(
        actual != null,
        negate ? `Expected ${fmt(actual)} not to exist` : `Expected value to exist but got ${fmt(actual)}`,
        false
      ),
    be: buildBe(actual, negate),
    have: buildHave(actual, negate),
  };

  if (!negate) {
    return { ...chain, not: buildTo(actual, true) };
  }
  return chain;
}

export function createPmExpect(actual: unknown) {
  return { to: buildTo(actual, false) };
}

export async function runPmTest(
  name: string,
  fn: () => void | Promise<void>,
  testResults: PmTestResult[]
): Promise<void> {
  try {
    await fn();
    testResults.push({ name, passed: true });
  } catch (e: unknown) {
    const err = e as { message?: string };
    testResults.push({ name, passed: false, error: err.message || String(e) });
  }
}
