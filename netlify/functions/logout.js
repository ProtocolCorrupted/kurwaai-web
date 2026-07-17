const { clearCookie, json } = require("./_auth");

exports.handler = async () => {
  return json(200, { ok: true }, { "Set-Cookie": clearCookie() });
};
