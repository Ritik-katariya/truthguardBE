const express = require('express');
const router = express.Router();
const { checkContent } = require('../controllers/checkcontroller');

router.post('/', checkContent);

module.exports = router;
