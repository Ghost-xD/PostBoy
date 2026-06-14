# Variables in Ripple

Ripples supports multiple types of variables for dynamic request configuration.

## Variable Scopes

Variables are resolved in this order (later scopes override earlier ones):
1. **Global Variables** - Available in all collections
2. **Collection Variables** - Available within a specific collection  
3. **Environment Variables** - Active environment overrides collection variables

## Environment Variables

### Creating Variables
1. Open **Tools → Environments** (`Ctrl+Shift+V`)
2. Select or create an environment
3. Add key/value pairs in the variables section

### Secret Variables
Mark sensitive variables (API keys, passwords) as secret:
- Toggle the 🔒 icon when editing variables
- Secret variables display as `••••••••` in UI
- Click masked values to edit temporarily
- Function normally in `{{variable}}` interpolation

### Initial vs Current Values
- **Initial Value**: The original/default value
- **Current Value**: The active value (may be updated by scripts)
- Use **Reset Values** to restore current from initial

## Dynamic Variables

Dynamic variables generate fresh values on each request. Use Postman-compatible syntax:

### UUIDs and Identifiers
- `{{$guid}}` - Generate UUID v4
- `{{$randomUUID}}` - Same as $guid

### Numbers  
- `{{$randomInt}}` - Random integer (0-999)
- `{{$randomFloat}}` - Random float with 2 decimals
- `{{$randomBoolean}}` - "true" or "false"

### Timestamps
- `{{$timestamp}}` - Unix timestamp (seconds)
- `{{$isoTimestamp}}` - ISO 8601 timestamp
- `{{$unixTimestamp}}` - Unix timestamp (milliseconds)

### Fake Data
- `{{$randomFirstName}}` - Random first name
- `{{$randomLastName}}` - Random last name  
- `{{$randomFullName}}` - Full name
- `{{$randomEmail}}` - Email address
- `{{$randomColor}}` - Hex color code
- `{{$randomWord}}` - Single word
- `{{$randomWords}}` - Three words
- `{{$randomIP}}` - IP address
- `{{$randomPhoneNumber}}` - Phone number

### Examples

```
GET https://api.example.com/users/{{$guid}}
Authorization: Bearer {{apiToken}}
X-Request-ID: {{$randomUUID}}
```

## Usage in Requests

Variables work in:
- Request URLs
- Headers (names and values)
- Request bodies (JSON, form data, raw)
- Chain step configurations

## Testing Variables

Use the environment switcher in the request bar to test different configurations:
1. Set variables in multiple environments
2. Switch environments to see different values
3. Dynamic variables generate fresh values on each request