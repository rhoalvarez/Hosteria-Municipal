const router=require('express').Router(); const asyncHandler=require('../utils/asyncHandler'); const c=require('../controllers/auth.controller');
router.post('/login',asyncHandler(c.login)); router.post('/setup/admin',asyncHandler(c.setupAdmin)); module.exports=router;
