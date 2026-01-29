# Better-Auth to Catalyst Backend - Integration Plan

## Executive Summary

**Status:** ✅ Analysis Complete
**Date:** Generated Jan 2025
**Target:** Catalyst Backend v1.0.0

Better-auth is a comprehensive authentication framework that requires 3 new Prisma models to manage sessions, OAuth accounts, and email verification. The existing Catalyst schema remains largely unchanged, with only the User model being extended.

---

## What Better-Auth Provides

```
better-auth (v1.4.18)
├── Authentication Management
│   ├── Email/Password registration & login
│   ├── OAuth provider support (GitHub, Google, etc.)
│   ├── Account linking (multiple providers per user)
│   └── Password reset flows
├── Session Management
│   ├── Secure token generation
│   ├── Session expiration
│   └── IP & User-Agent tracking
├── Email Verification
│   ├── Email verification codes
│   ├── Custom verification workflows
│   └── Expiration handling
└── Extensibility
    ├── Plugin system
    ├── Rate limiting
    └── 2FA, passkeys, etc.
```

---

## Schema Changes Required

### NEW MODELS (3):

#### 1️⃣ **session** Table
```
Columns: 8
- id (PK)
- token (unique)
- userId (FK → User) 
- expiresAt
- createdAt, updatedAt
- ipAddress?, userAgent?
```
**Purpose:** Manage user sessions

#### 2️⃣ **account** Table  
```
Columns: 14
- id (PK)
- userId (FK → User)
- providerId ("email", "github", etc.)
- accountId (OAuth account ID)
- password? (for email/password)
- accessToken? (for OAuth)
- refreshToken? (for OAuth)
- createdAt, updatedAt
- [+ other OAuth fields]
```
**Purpose:** Store OAuth accounts and password hashes

#### 3️⃣ **verification** Table
```
Columns: 6
- id (PK)
- identifier (email, phone, etc.)
- value (code/token)
- expiresAt
- createdAt, updatedAt
```
**Purpose:** Email verification codes, password reset tokens

### MODIFIED MODELS (1):

#### 👤 **User** Table (Extended)
```
ADDED Fields (3):
+ name (String) - required by better-auth
+ emailVerified (Boolean) - default false
+ image (String?) - optional profile image

ADDED Relations (2):
+ accounts: account[]
+ sessions: session[]

REMOVED Fields (1):
- password → migrated to account.password

KEPT Fields:
✓ id, email, username (all existing)
✓ createdAt, updatedAt
✓ All existing relations (roles, servers, audit, alerts)
```

### UNCHANGED MODELS (10+):
```
✓ Role, ServerRole, ServerAccess, ServerAccessInvite
✓ Location, Node, Server, ServerTemplate
✓ Backup, ScheduledTask, ServerLog
✓ AuditLog, AuthLockout
✓ NodeMetrics, ServerMetrics
✓ Alert, AlertRule, AlertDelivery
✓ DatabaseHost, ServerDatabase
✓ IpPool, IpAllocation, NodeAllocation
✓ DeploymentToken
```

---

## Migration Impact Analysis

| Aspect | Impact | Severity |
|--------|--------|----------|
| Data Loss | None (additive schema) | ✅ None |
| Breaking Changes | Password field moves | ⚠️ Low |
| Performance | Indexes on new tables | ✅ Positive |
| Compatibility | Fully compatible | ✅ Yes |
| Effort | Moderate | ⏱️ 2-3 days |

---

## Configuration Checklist

### Step 1: Update Environment
```env
# Add to .env
BETTER_AUTH_SECRET="<generate-random-32-char-string>"
BETTER_AUTH_TRUST_HOST=true
BETTER_AUTH_URL="http://localhost:3000"
```

### Step 2: Update Prisma Schema
```prisma
// In prisma/schema.prisma

// Add these 3 models:
model session { ... }
model account { ... }
model verification { ... }

// Update existing User model:
model User {
  // ... existing fields ...
  
  // Add these:
  name              String
  emailVerified     Boolean   @default(false)
  image             String?
  
  // Add relations:
  accounts          account[]
  sessions          session[]
}
```

### Step 3: Run Migration
```bash
npx prisma migrate dev --name add_better_auth
npx prisma generate
```

### Step 4: Initialize Better-Auth
```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    usePlural: false,
    transaction: false,
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
});
```

### Step 5: Update Routes & Middleware
- Replace custom auth routes with better-auth endpoints
- Update session verification middleware
- Update user lookup to use new better-auth tables

---

## File Locations

### Generated Schema Files
```
/root/catalyst3/catalyst-backend/
├── schema-additions.prisma      ← New models (session, account, verification)
├── updated-user-model.prisma    ← Extended User model with migration notes
├── generate-better-auth-schema.ts ← Script to generate schema
└── BETTER_AUTH_MIGRATION.md     ← This file
```

---

## Current vs. New Authentication

### Before (Current System)
```
┌─────────────┐
│   Register  │
└──────┬──────┘
       │ email, username, password
       ▼
┌─────────────────────────────────┐
│ User Table                      │
│ - id, email, username           │
│ - password (bcrypt)             │
│ - username unique               │
└─────────────────────────────────┘
       │
       └─ Manual JWT generation
         │
         └─ Stored in cookie/localStorage
```

### After (Better-Auth System)
```
┌─────────────┐      ┌─────────────┐
│  Register   │      │  OAuth Link │
└──────┬──────┘      └──────┬──────┘
       │ email, password    │ provider
       ▼                    ▼
┌─────────────────────────────────┐
│ Account Table (NEW)             │
│ - OAuth: token, provider, scope │
│ - Email: password hash          │
└─────────────────────────────────┘
       │
       └──────┬──────────┬──────────┐
              │          │          │
              ▼          ▼          ▼
         ┌─────────────────┐  ┌──────────────┐
         │ User (extended) │  │ Session      │
         │ - id, email     │  │ (NEW)        │
         │ - name, image   │  │ - token      │
         │ - emailVerified │  │ - ipAddress  │
         └─────────────────┘  └──────────────┘
              │
              ▼
         ┌──────────────┐
         │ Verification │
         │ (NEW)        │
         │ - codes      │
         │ - reset link │
         └──────────────┘
```

---

## Benefits

### Immediate ✅
- ✓ Secure session management
- ✓ Email verification support
- ✓ Password reset flows
- ✓ OAuth provider support (GitHub, Google, etc.)
- ✓ Account linking

### Developer Experience 📝
- ✓ No need to write auth logic
- ✓ Built-in security best practices
- ✓ Comprehensive plugin ecosystem
- ✓ TypeScript types included
- ✓ Easy to extend

### Security 🔒
- ✓ Industry-standard password hashing
- ✓ Session token generation
- ✓ CSRF protection (built-in)
- ✓ Rate limiting support
- ✓ Account lockout prevention

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Password migration issues | Low | High | Pre-migration backup & validation script |
| Session incompatibility | Low | Medium | Comprehensive testing before deploy |
| Performance regression | Very Low | Low | Add indexes as needed |
| User confusion | Medium | Low | Clear communication & gradual rollout |

---

## Timeline

```
Day 1:  Schema analysis & planning       ✅ DONE
Day 2:  Create migration & test locally
Day 3:  Integration testing & auth route updates
Day 4:  User data migration & validation
Day 5:  Staging deployment & QA
Day 6:  Production deployment
```

---

## Questions to Address Before Implementation

1. **User Migration:** How to migrate existing users?
   - Option A: Auto-create accounts with current passwords
   - Option B: Force password reset on next login
   - Option C: Hybrid (remember users, others reset)

2. **Username vs Email:** Keep username field or email-only?
   - Recommended: Keep for backward compatibility

3. **OAuth Providers:** Which providers to support initially?
   - Suggested: GitHub, Google (most common)

4. **Email Service:** Will email verification require SMTP?
   - Yes, for production (already configured in SystemSetting)

5. **Rate Limiting:** Use better-auth built-in or existing system?
   - Suggested: better-auth for auth endpoints

---

## Testing Checklist

Before going to production:
- [ ] Local migration succeeds
- [ ] All existing user data preserved
- [ ] Login with email/password works
- [ ] Session management works
- [ ] Email verification works
- [ ] Password reset works
- [ ] OAuth links successfully
- [ ] Server access controls still work
- [ ] Audit logging still captures events
- [ ] No breaking changes to API clients

---

## Resources

- 📖 [Better-Auth Docs](https://better-auth.com/docs)
- 🐙 [GitHub Repository](https://github.com/better-auth/better-auth)
- 📚 [Prisma Schema Guide](https://www.prisma.io/docs/concepts/components/prisma-schema)
- 🔐 [OWASP Auth Best Practices](https://owasp.org/www-community/attacks/Session_fixation)

---

## Next Actions

1. **Review** the generated schema files
2. **Discuss** migration strategy with team
3. **Create** migration script for existing users
4. **Setup** test database for validation
5. **Begin** Phase 1 implementation

---

**Generated by:** better-auth CLI analysis tool
**Status:** Ready for implementation
**Last Updated:** Jan 29, 2025
