/**
 * The distribution only adds index.html at the root, so a folder address such
 * as /hush-log/ asks for a key that does not exist. Without this the reader is
 * silently served the front page instead of the report they asked for, with a
 * 200, which is worse than an error because nothing looks wrong.
 */
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }

  return request;
}
