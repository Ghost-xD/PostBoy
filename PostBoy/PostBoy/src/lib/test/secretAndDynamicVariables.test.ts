import { describe, it, expect } from 'vitest';
import { generateDynamicVariable, isDynamicVariable } from '$lib/utils/dynamicVariables';
import { interpolate, interpolateJson } from '$lib/stores/variableStore';

describe('Secret and Dynamic Variables Integration', () => {
  describe('Dynamic Variables', () => {
    it('should detect dynamic variables', () => {
      expect(isDynamicVariable('$guid')).toBe(true);
      expect(isDynamicVariable('$randomInt')).toBe(true);
      expect(isDynamicVariable('$timestamp')).toBe(true);
      expect(isDynamicVariable('regularVar')).toBe(false);
      expect(isDynamicVariable('$unknown')).toBe(false);
    });

    it('should generate UUID for $guid', () => {
      const result = generateDynamicVariable('$guid');
      expect(result).toBeDefined();
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should generate random integer for $randomInt', () => {
      const result = generateDynamicVariable('$randomInt');
      expect(result).toBeDefined();
      const num = parseInt(result!, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(1000);
    });

    it('should generate timestamp for $timestamp', () => {
      const result = generateDynamicVariable('$timestamp');
      expect(result).toBeDefined();
      const num = parseInt(result!, 10);
      expect(num).toBeGreaterThan(1600000000); // Roughly 2020
    });

    it('should return undefined for unknown dynamic variable', () => {
      const result = generateDynamicVariable('$unknown');
      expect(result).toBeUndefined();
    });
  });

  describe('Enhanced Interpolation', () => {
    it('should interpolate dynamic variables', () => {
      const text = 'User ID: {{$guid}}, Random: {{$randomInt}}';
      const result = interpolate(text, undefined);
      
      expect(result).not.toContain('{{$guid}}');
      expect(result).not.toContain('{{$randomInt}}');
      expect(result).toMatch(/User ID: [0-9a-f-]{36}, Random: \d+/);
    });

    it('should interpolate regular variables alongside dynamic ones', () => {
      const text = 'API: {{baseUrl}}/users/{{$guid}}';
      const result = interpolate(text, undefined, { baseUrl: 'https://api.example.com' });
      
      expect(result).toContain('https://api.example.com/users/');
      expect(result).not.toContain('{{baseUrl}}');
      expect(result).not.toContain('{{$guid}}');
    });

    it('should leave unknown dynamic variables unchanged', () => {
      const text = 'ID: {{$unknownVariable}}';
      const result = interpolate(text, undefined);
      
      expect(result).toBe('ID: {{$unknownVariable}}');
    });

    it('should generate fresh values on each call', () => {
      const text = '{{$randomInt}}';
      const result1 = interpolate(text, undefined);
      const result2 = interpolate(text, undefined);
      
      // Should be different (with very high probability)
      expect(result1).not.toBe(result2);
    });

    it('should work in JSON interpolation', () => {
      const json = '{"id": "{{$guid}}", "value": {{$randomInt}}}';
      const result = interpolateJson(json, undefined);
      
      expect(result).not.toContain('{{$guid}}');
      expect(result).not.toContain('{{$randomInt}}');
      expect(result).toMatch(/"id": "[0-9a-f-]{36}", "value": \d+/);
    });

    it('should handle mixed variable interpolation', () => {
      const text = 'Auth: Bearer {{apiToken}}, ID: {{$guid}}, Number: {{$randomInt}}';
      const result = interpolate(text, undefined, { apiToken: 'secret123' });
      
      expect(result).toContain('Auth: Bearer secret123');
      expect(result).toMatch(/ID: [0-9a-f-]{36}/);
      expect(result).toMatch(/Number: \d+/);
    });
  });

  describe('Comprehensive Dynamic Variables', () => {
    const dynamicVars = [
      '$guid', '$randomUUID', '$randomInt', '$randomFloat', '$timestamp', 
      '$isoTimestamp', '$unixTimestamp', '$randomFirstName', '$randomLastName',
      '$randomFullName', '$randomEmail', '$randomColor', '$randomWord', '$randomWords',
      '$randomBoolean', '$randomIP', '$randomPhoneNumber'
    ];

    it.each(dynamicVars)('should generate values for %s', (varName) => {
      const result = generateDynamicVariable(varName);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });
  });
});