# Système de compatibilité

## Concepts

### `requires` - Dépendances par **catégorie**
Liste les **catégories** de stacks requises.

**Exemple :**
```typescript
prisma: {
  requires: ['database'], // Prisma nécessite qu'une database soit choisie
}
```

**Signification :** Pour utiliser Prisma, l'utilisateur DOIT choisir une option dans la catégorie `database` (peu importe laquelle : postgres, mysql, etc.).

### `incompatible` - Exclusions par **stack**
Liste les **stacks spécifiques** incompatibles.

**Exemple :**
```typescript
prisma: {
  incompatible: ['drizzle'], // Prisma incompatible avec le stack Drizzle
}
```

**Signification :** Si l'utilisateur choisit Prisma, il ne peut PAS choisir Drizzle (et inversement).

## Validation

Le système valide automatiquement :

1. **Dépendances manquantes** : Si un stack avec `requires: ['database']` est choisi sans database
2. **Incompatibilités** : Si deux stacks marqués incompatibles sont choisis ensemble

## Exemples

### ✅ Configuration valide
```typescript
{
  orm: 'prisma',
  database: 'postgres'
}
// ✓ Prisma requiert database → postgres fourni
```

### ❌ Configuration invalide
```typescript
{
  orm: 'prisma',
  database: undefined
}
// ✗ Prisma requiert database → manquante
```

### ❌ Incompatibilité détectée
```typescript
{
  orm: 'prisma',
  // ... tentative de choisir drizzle ailleurs
}
// ✗ Prisma incompatible avec drizzle
```

## Types TypeScript

Le système est **type-safe** :

- `Category` = `'repo' | 'framework' | 'backend' | 'orm' | 'database' | 'extras'`
- `AllStackNames` = `'single' | 'turborepo' | 'nextjs' | 'hono' | 'prisma' | 'drizzle' | 'postgres' | ...`

```typescript
interface Stack {
  requires?: Category[];        // Catégories requises
  incompatible?: AllStackNames[]; // Stacks incompatibles
}
```
