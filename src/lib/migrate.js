/**
 * Bringing older stored data up to date.
 *
 * Entities are stored as documents, so a rename in the code does not rename
 * what is already in the database. Every entity is run through here on its way
 * into the app, which keeps the migration in one readable place instead of
 * scattering `=== 'tripod' || === 'mast'` checks through the components.
 *
 * These run on read and are not written back on their own. A plan is rewritten
 * in the new shape the next time somebody edits it, so a plan nobody touches
 * keeps working and costs nothing.
 */

/** Mount types that have been renamed. Old id on the left, current on the right. */
const CAM_TYPE_RENAMES = {
  // The kit was called a tripod throughout the first builds. It is a mast.
  tripod: 'mast',
};

export function migrateEntity(entity) {
  if (!entity || entity.kind !== 'camera') return entity;
  const renamed = CAM_TYPE_RENAMES[entity.camType];
  return renamed ? { ...entity, camType: renamed } : entity;
}

export const migratePlan = (plan) =>
  (plan?.entities?.length ? { ...plan, entities: plan.entities.map(migrateEntity) } : plan);

export const migratePlans = (plans = []) => plans.map(migratePlan);
