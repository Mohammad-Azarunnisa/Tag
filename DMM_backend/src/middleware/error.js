export const notFound = (req, res, next) => {
  res.status(404);
  next(new Error(`Not Found - ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  let message = err.message;

  if (err.name === 'MulterError') {
    statusCode = 400;
    // LIMIT_FILE_SIZE fires above the app's own cap (middleware/upload.js). If
    // an upload instead fails at a much smaller fixed threshold (~1 MB), the
    // block is almost certainly a reverse proxy (nginx client_max_body_size)
    // in front of Node, not this app.
    message = `Upload error: ${err.message}`;
  }

  // The database itself is unreachable (DNS/network drop, Atlas down). Say so
  // plainly rather than a vague 500, so a sign-in screen can tell the person
  // it is the connection, not their password.
  const dbDown = ['MongoNetworkError', 'MongoServerSelectionError', 'MongooseServerSelectionError', 'MongoNetworkTimeoutError'].includes(err.name)
    || /buffering timed out|ENOTFOUND|EAI_AGAIN|getaddrinfo|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|Server selection timed out/i.test(err.message || '');
  if (dbDown) {
    statusCode = 503;
    message = 'The database cannot be reached right now. Please check the internet connection and try again in a moment.';
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = 'Resource not found';
  }
  // Duplicate key
  if (err.code === 11000) {
    statusCode = 400;
    message = `Duplicate value for: ${Object.keys(err.keyValue).join(', ')}`;
  }
  // Validation
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  }

  res.status(statusCode).json({
    success: false,
    message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
};
