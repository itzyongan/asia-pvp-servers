// GET /api/rtt -> "ok". The page times this on a warm connection to learn its round trip to this site's Singapore
// functions (see vercel.json), which is the first leg of the Singapore ping route.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send("ok");
};
