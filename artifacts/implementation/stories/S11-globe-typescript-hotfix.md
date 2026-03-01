# S11: Globe TypeScript Hotfix

**Type**: hotfix
**Priority**: CRITICAL (blocks Docker build)
**Effort**: 0.5h
**Files**: `src/frontend/components/globe/tactical-globe.tsx`

---

## Context

Docker build fails with three TypeScript errors in `tactical-globe.tsx:107`. All are type annotation issues with the `react-globe.gl` component API. No logic changes needed.

---

## Acceptance Criteria

### AC1: `ref` type fixed
`globeRef` must be `MutableRefObject<GlobeMethods | undefined>` not `RefObject<unknown>`.

- Import `GlobeMethods` from `react-globe.gl`: `import type { GlobeMethods } from 'react-globe.gl'`
- Change: `const globeRef = useRef<unknown>(null)` → `const globeRef = useRef<GlobeMethods | undefined>(undefined)`
- Update the `useEffect` cast: remove the manual cast `as { controls: () => ... }`, use `globeRef.current` directly since `GlobeMethods` has `.controls()` method.

### AC2: `onPointClick` handler signature fixed
The `react-globe.gl` `onPointClick` callback signature is `(point: object, event: MouseEvent, coords: {...}) => void`. The current parameter type `Record<string, unknown>` is incompatible with `object`.

- Change handler signature to accept `object`:
  ```typescript
  function handlePointClick(point: object) {
    const pt = point as Record<string, unknown>
    const sectorId = pt.sectorId as string
    const resource = pt.resource as string
    const item = sectors.find((s) => s.sector_id === sectorId && s.resource_type === resource)
    setTooltip({
      sector: sectorId,
      resource: resource,
      stock: item?.latest_stock_level ?? 0,
    })
  }
  ```

### AC3: Arc data null filtering fixed
`.filter(Boolean)` does not remove `null` from the TypeScript union type. The array type becomes `(Arc | null)[]` which fails `arcsData: object[]`.

- Change the filter to a type guard:
  ```typescript
  .filter((arc): arc is NonNullable<typeof arc> => arc !== null)
  ```

### AC4: Tests still pass
Run `npm run type-check` (or `npx tsc --noEmit`) and confirm no TypeScript errors in this file. Existing tests in `__tests__/marvel-map.test.tsx` (or globe test) must still pass.

---

## Dev Notes

- File: `src/frontend/components/globe/tactical-globe.tsx`
- The `GlobeMethods` type from `react-globe.gl` provides `.controls()` method — no need for the manual cast in the useEffect
- Do NOT change any visual logic, data shape, or behavior — purely type annotation changes
- Check if `react-globe.gl` exports `GlobeMethods` — if not, use `import type { GlobeMethods } from 'react-globe.gl'` or fall back to a local interface: `interface GlobeMethods { controls: () => { autoRotate: boolean; autoRotateSpeed: number } }`
