export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(issues, message = 'Request validation failed') {
    super(400, 'VALIDATION_ERROR', message, { issues });
  }
}

export class NotFoundError extends HttpError {
  constructor(resource, id) {
    super(404, 'NOT_FOUND', `${resource} ${id} not found`);
  }
}

export class ConflictError extends HttpError {
  constructor(code, message, details) {
    super(409, code, message, details);
  }
}
