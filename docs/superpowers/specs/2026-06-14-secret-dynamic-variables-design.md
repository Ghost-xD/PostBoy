# Secret Variables and Dynamic Variables Design

**Date:** 2026-06-14  
**Feature:** Secret variable type and Postman-compatible dynamic variables  
**Gap Reference:** POSTMAN-GAP.md - Environment variables missing secret type and dynamic `{{$...}}` variables

## Overview

This design adds two critical missing features to PostBoy's environment system:

1. **Secret Variables** - Variables marked as secret with UI masking (••••) but normal interpolation behavior
2. **Dynamic Variables** - Postman-compatible `{{$guid}}`, `{{$randomInt}}`, etc. that generate fresh values on each request

Both features integrate with the existing variable interpolation system and maintain full backward compatibility.

## Requirements

### Secret Variables
- UI toggle to mark environment variables as secret
- Masked display (••••••••) in all UI contexts when not actively editing
- Normal `{{variable}}` interpolation behavior (no functional changes)
- Plain text storage with UI masking only (no encryption)
- Backward compatibility with existing variables (default to non-secret)

### Dynamic Variables  
- Full Postman compatibility for dynamic variable names and behavior
- Fresh value generation on each request send (not cached)
- Available wherever normal `{{variable}}` interpolation works
- Support for UUIDs, random data, timestamps, fake data generation
- Graceful fallback for unknown dynamic variables

## Architecture

**Approach:** Incremental Schema + Interpolation Enhancement

This surgical approach:
- Adds minimal database schema changes
- Enhances existing interpolation without breaking compatibility  
- Keeps secret variables as a simple UI concern
- Implements dynamic variables within the current variable system

## Database Schema Changes

### Environment Variables Table Enhancement

```sql
-- Migration: Add secret variable support
ALTER TABLE environment_variables 
ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 0;
```

**Updated schema:**
```sql
CREATE TABLE environment_variables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    environment_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    initial_value TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    is_secret INTEGER NOT NULL DEFAULT 0,  -- NEW: boolean flag for UI masking
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
    UNIQUE(environment_id, key)
);
```

**Migration behavior:**
- Existing variables default to `is_secret=0` (not secret)
- Full backward compatibility maintained
- No data migration required

## TypeScript Interface Updates

### Environment Variable Interface

```typescript
export interface EnvironmentVariable {
  key: string;
  value: string;
  initial_value: string;
  enabled: boolean;
  is_secret: boolean;  // NEW - tracks if variable should be masked in UI
}
```

### API Layer Changes

**Tauri Command Updates:**
```rust
// In src-tauri/src/commands/mod.rs
pub async fn db_set_environment_variable(
    environment_id: i64,
    key: String,
    value: String,
    initial_value: Option<String>,
    is_secret: Option<bool>,  // NEW - optional for backward compatibility
) -> Result<(), String>
```

**API Interface:**
```typescript
// In src/lib/api/tauri.ts
async setEnvironmentVariable(
  environmentId: number, 
  key: string, 
  value: string, 
  initialValue?: string,
  isSecret?: boolean  // NEW - defaults to false
): Promise<void>
```

## UI Components for Secret Variables

### Environment Variable Editor

**Features:**
- Secret toggle (checkbox/button) in variable rows
- Conditional masking: show `••••••••` when secret and not editing
- Click-to-edit: reveal actual value temporarily during editing
- Visual secret indicator (lock icon)

**Component Structure:**
```svelte
<div class="variable-row">
  <input bind:value={variable.key} placeholder="Key" />
  
  <!-- Value input with conditional masking -->
  {#if variable.is_secret && !editingValue}
    <div class="masked-value" onclick={() => editingValue = true}>
      ••••••••
    </div>
  {:else}
    <input 
      bind:value={variable.value} 
      placeholder="Value"
      onblur={() => editingValue = false}
    />
  {/if}
  
  <!-- Secret toggle -->
  <label class="secret-toggle">
    <input type="checkbox" bind:checked={variable.is_secret} />
    <span class="secret-icon">🔒</span>
  </label>
  
  <!-- Existing enabled toggle -->
  <input type="checkbox" bind:checked={variable.enabled} />
</div>
```

### Request UI Masking

Secret variables display as masked in:
- Request URL preview
- Header value display  
- Body value display (when not actively editing)

**Masking behavior:**
- Show `••••••••` in read-only contexts
- Reveal actual value during active editing
- Normal interpolation in actual HTTP requests

## Dynamic Variables Implementation

### Dynamic Variable Library

**Core dynamic variables matching Postman:**

```typescript
const DYNAMIC_VARIABLES = {
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
  
  // Fake data (using predefined arrays of common names/words)
  '$randomFirstName': () => FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)],
  '$randomLastName': () => LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)],
  '$randomEmail': () => `${generateRandomString(8)}@example.com`,
  '$randomColor': () => `#${Math.floor(Math.random()*16777215).toString(16).padStart(6,'0')}`,
  '$randomWord': () => WORDS[Math.floor(Math.random() * WORDS.length)],
  '$randomWords': () => Array.from({length: 3}, () => WORDS[Math.floor(Math.random() * WORDS.length)]).join(' '),
  '$randomIP': () => Array.from({length: 4}, () => Math.floor(Math.random() * 256)).join('.'),
  '$randomMACAddress': () => Array.from({length: 6}, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':'),
  
  // Additional Postman variables
  '$randomBoolean': () => Math.random() > 0.5 ? 'true' : 'false',
  '$randomDateRecent': () => new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
  '$randomDateFuture': () => new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
} as const;
```

### Enhanced Interpolation Function

**Updated `interpolate()` function:**
```typescript
export function interpolate(
  text: string,
  collectionId: number | undefined,
  overrides?: Record<string, string>
): string {
  if (!text || !text.includes('{{')) return text;

  const varMap = buildInterpolationMap(collectionId, overrides);

  return text.replace(VARIABLE_REGEX, (match, varName) => {
    const trimmed = varName.trim();
    
    // Check for dynamic variables first
    if (trimmed.startsWith('$') && DYNAMIC_VARIABLES[trimmed]) {
      return DYNAMIC_VARIABLES[trimmed]();
    }
    
    // Fall back to regular variables
    return varMap.has(trimmed) ? varMap.get(trimmed)! : match;
  });
}
```

**Behavior:**
- Dynamic variables generate fresh values on each interpolation call
- Values are NOT cached between requests (matches Postman behavior)
- Unknown dynamic variables fall back to original `{{$unknown}}` text
- Works in all interpolation contexts (URLs, headers, bodies, chains)

## Implementation Phases

### Phase 1: Secret Variables
1. **Database Migration** - Add `is_secret` column with migration script
2. **Tauri Commands** - Update commands to handle `is_secret` parameter
3. **TypeScript Interfaces** - Update `EnvironmentVariable` interface
4. **UI Components** - Add secret toggle and masking to environment editor
5. **API Integration** - Wire up secret flag in store operations
6. **Testing** - Verify masking, interpolation, and migration

### Phase 2: Dynamic Variables  
1. **Dynamic Variable Library** - Implement all Postman-compatible generators
2. **Enhanced Interpolation** - Update `interpolate()` to handle `{{$...}}` patterns
3. **Fake Data Sources** - Add predefined arrays: ~100 common first names, ~100 last names, ~500 common English words for realistic fake data generation
4. **Helper Functions** - Implement `generateRandomString()` and other utility functions
5. **Performance Testing** - Ensure good performance with multiple dynamic variables
6. **Documentation** - Update variable documentation with dynamic variable examples
7. **Testing** - Comprehensive testing of all dynamic variable types

## Testing Strategy

### Secret Variables Testing
- **Database Migration** - Existing variables remain functional, new variables can be marked secret
- **UI Masking** - Values masked in display, revealed during editing
- **Interpolation** - Secret variables work normally in `{{variable}}` replacement
- **Export/Import** - Secret flag preserved in environment export/import

### Dynamic Variables Testing
- **Generation** - Each dynamic variable type produces appropriate values
- **Freshness** - New values generated on each request send
- **Fallback** - Unknown dynamic variables remain as original text
- **Performance** - Multiple dynamic variables in one request perform well
- **Interpolation Contexts** - Work in URLs, headers, JSON bodies, chain steps

### Error Handling
- **Migration Errors** - Graceful handling if migration fails
- **Missing Fields** - API calls without `is_secret` default to `false`
- **Dynamic Variable Errors** - Failed generation falls back to original text
- **UI Errors** - Masking UI handles missing or invalid secret flags

## Backward Compatibility

### Database
- Existing environment variables continue to work unchanged
- New `is_secret` column defaults to `0` (false) for all existing data
- No data migration or conversion required

### API
- Existing API calls without `is_secret` parameter continue to work
- New parameter is optional and defaults to `false`
- No breaking changes to existing function signatures

### Export/Import
- Export format includes new `is_secret` field
- Import gracefully handles missing `is_secret` field (defaults to `false`)
- Existing environment files import successfully

### Interpolation
- Existing `{{variable}}` interpolation unchanged
- Dynamic variables additive - no impact on existing variable resolution
- Unknown dynamic variables don't break interpolation

## Success Criteria

### Secret Variables
- ✅ Users can mark environment variables as secret via UI toggle
- ✅ Secret variables display as `••••••••` in all non-editing contexts
- ✅ Secret variables work normally in `{{variable}}` interpolation
- ✅ Existing variables continue to work without modification
- ✅ Export/import preserves secret status

### Dynamic Variables
- ✅ All major Postman dynamic variables are supported
- ✅ Fresh values generated on each request send (not cached)
- ✅ Work in URLs, headers, bodies, and chain configurations
- ✅ Unknown dynamic variables gracefully fall back to original text
- ✅ Performance remains good with multiple dynamic variables per request

## Future Considerations

### Potential Enhancements
- **Encrypted Storage** - Could enhance secret variables with actual encryption
- **Custom Dynamic Variables** - User-defined dynamic variable generators
- **Dynamic Variable Debugging** - UI to preview dynamic variable outputs
- **More Fake Data Types** - Additional realistic fake data generators

### Migration Path
- Secret variables foundation supports future encryption enhancement
- Dynamic variable system extensible for custom generators
- UI framework supports additional variable types and features

## Conclusion

This design provides a surgical, backward-compatible implementation of secret variables and dynamic variables that brings PostBoy to feature parity with Postman's environment system. The incremental approach minimizes risk while delivering both features that users expect from a professional API development tool.