import { ValidationError } from '../lib/errors.js';

// ['ingredients', 2, 'unit'] -> 'ingredients[2].unit'
export function formatPath(path) {
  return path.reduce((result, key) => {
    if (typeof key === 'number') return `${result}[${key}]`;
    return result ? `${result}.${String(key)}` : String(key);
  }, '');
}

/**
 * Validates req.params / req.query / req.body against zod schemas and stores the parsed
 * values in req.validated (Express 5 does not allow overwriting req.query).
 */
export function validate(schemas) {
  return (req, res, next) => {
    req.validated = {};
    const issues = [];

    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source] ?? {});
      if (result.success) {
        req.validated[source] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({ path: formatPath([source, ...issue.path]), message: issue.message });
        }
      }
    }

    if (issues.length > 0) throw new ValidationError(issues);
    next();
  };
}
