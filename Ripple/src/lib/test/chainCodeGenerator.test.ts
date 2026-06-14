import { describe, it, expect } from 'vitest';
import {
  buildChainCodegenInput,
  generateChainFetch,
  generateChainPython,
  type ChainCodegenInput,
} from '$lib/utils/chainCodeGenerator';
import type { Chain } from '$lib/utils/chainRunner';

const chain: Chain = {
  id: 'c1',
  name: 'GetLicense',
  steps: [
    {
      id: 's1',
      requestId: 1,
      extractions: [{ jsonPath: 'accessToken', variableName: 'accessToken' }],
    },
    { id: 's2', requestId: 2, extractions: [] },
  ],
};

const requests = [
  {
    id: 1,
    name: 'apikey token',
    method: 'POST',
    url: 'https://api.com/login',
    headers: '[]',
    params: '[]',
    auth_type: 'none',
    auth_data: '{}',
    body_type: 'none',
  },
  {
    id: 2,
    name: 'get license',
    method: 'GET',
    url: 'https://api.com/license',
    headers: JSON.stringify([{ key: 'Authorization', value: 'Bearer {{apiToken}}' }]),
    params: '[]',
    auth_type: 'none',
    auth_data: '{}',
    body_type: 'none',
  },
];

describe('buildChainCodegenInput', () => {
  it('builds steps from chain and requests', () => {
    const input = buildChainCodegenInput(chain, requests);
    expect(input?.chainName).toBe('GetLicense');
    expect(input?.steps).toHaveLength(2);
    expect(input?.steps[0].extractions[0].variableName).toBe('accessToken');
  });

  it('returns null when no resolvable steps', () => {
    expect(buildChainCodegenInput({ ...chain, steps: [] }, requests)).toBeNull();
  });
});

describe('generateChainFetch', () => {
  it('wires step 1 extraction into step 2 Authorization header', () => {
    const input = buildChainCodegenInput(chain, requests)!;
    const code = generateChainFetch(input);

    expect(code).toContain('// Chain: GetLicense');
    expect(code).toContain("vars['accessToken'] = data1.accessToken");
    expect(code).toContain('`Bearer ${vars[\'accessToken\']}`');
    expect(code).toContain('const response2 = await fetch');
  });
});

describe('generateChainPython', () => {
  it('uses f-string for bearer token from prior step', () => {
    const input = buildChainCodegenInput(chain, requests)!;
    const code = generateChainPython(input);

    expect(code).toContain("vars['accessToken'] = data1['accessToken']");
    expect(code).toContain('f"Bearer {vars[\'accessToken\']}"');
  });
});

describe('generateChainFetch manual input', () => {
  it('supports multiple extractions', () => {
    const input: ChainCodegenInput = {
      chainName: 'Test',
      steps: [
        {
          stepNumber: 1,
          name: 'Login',
          options: {
            method: 'POST',
            url: 'https://api.com/login',
            headers: [],
            body: '{"user":"a"}',
            bodyType: 'json',
          },
          extractions: [
            { jsonPath: 'token', variableName: 'token' },
            { jsonPath: 'user.id', variableName: 'userId' },
          ],
        },
        {
          stepNumber: 2,
          name: 'Profile',
          options: {
            method: 'GET',
            url: 'https://api.com/users/{{userId}}',
            headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
          },
          extractions: [],
        },
      ],
    };

    const code = generateChainFetch(input);
    expect(code).toContain("vars['token'] = data1.token");
    expect(code).toContain("vars['userId'] = data1.user.id");
    expect(code).toContain('`Bearer ${vars[\'token\']}`');
    expect(code).toContain('`https://api.com/users/${vars[\'userId\']}`');
  });
});
