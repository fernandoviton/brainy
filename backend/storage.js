const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
function getStorage() {
  return require('./storage-supabase');
}
module.exports = { getStorage };
