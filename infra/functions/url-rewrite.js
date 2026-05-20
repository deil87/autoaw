// CloudFront Function — viewer request
// Rewrites dynamic Next.js static-export routes to their _ placeholder files.
//
// Static export generates one HTML file per generateStaticParams value.
// All dynamic experiment/trial IDs use "_" as the placeholder, so:
//   /experiments/exp_abc123/monitor  →  /experiments/_/monitor.html
//   /experiments/exp_abc123/trial/t_xyz  →  /experiments/_/trial/_.html
//
// Also appends .html to extensionless paths so S3 finds the file directly
// instead of falling through to the landing-page 404 handler.

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Remove trailing slash (except root "/")
  if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') {
    uri = uri.slice(0, -1);
  }

  // Rewrite dynamic experiment routes to the _ placeholder.
  // Known static segments under /experiments/: "new"
  var mExp = uri.match(/^\/experiments\/([^\/]+)(\/.*)?$/);
  if (mExp && mExp[1] !== 'new' && mExp[1] !== '_') {
    var rest = mExp[2] || '';
    // Handle nested /trial/[trialId]
    var mTrial = rest.match(/^\/trial\/([^\/]+)(\/.*)?$/);
    if (mTrial && mTrial[1] !== '_') {
      rest = '/trial/_' + (mTrial[2] || '');
    }
    uri = '/experiments/_' + rest;
  }

  // Append .html to paths that have no file extension in the last segment.
  // Detects "no extension" by checking the last dot comes before the last slash.
  if (uri !== '/' && uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {
    uri = uri + '.html';
  }

  request.uri = uri;
  return request;
}
