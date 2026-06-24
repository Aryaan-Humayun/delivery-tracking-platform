const { verifyAuthToken, AuthError } = require('../../middleware/auth.middleware');

// io.use() middleware: runs during the handshake, before 'connection' fires.
// Calling next(err) here rejects the handshake outright - the client gets a
// connect_error event with err.message and never reaches 'connection'.
async function socketAuthenticate(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;

  if (!token) {
    return next(new Error('missing auth token'));
  }

  try {
    const decoded = await verifyAuthToken(token);
    socket.user = { userId: decoded.userId, role: decoded.role };
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      return next(new Error(err.message));
    }
    next(new Error('authentication failed'));
  }
}

module.exports = socketAuthenticate;
