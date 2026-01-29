MCJARS Template Generator
------------------------

This folder contains generated Minecraft server templates. Use the generator at `scripts/generate-mcjars-templates.js` to fetch available projects from MCJARS and create per-project template files.

Usage:

```bash
# From repository root
node scripts/generate-mcjars-templates.js

# To overwrite existing templates
node scripts/generate-mcjars-templates.js --overwrite
```

Notes:
- The script attempts multiple MCJARS API endpoints if one fails.
- Each template will include a `PROJECT` variable prefilled with the MCJARS project slug and a `MC_VERSION` variable for the desired Minecraft version.
- Review and adjust any generated install scripts or startup commands as needed for specific projects (some projects use different jar names or custom launchers).
