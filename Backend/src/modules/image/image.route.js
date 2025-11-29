import { Router } from "express";
import { deleteImage, uploadImage } from "./image.controller.js";
import { upload } from "../../middelwares/multer.js";
const router = Router()

router.post("/", upload.single("image"), uploadImage)
router.delete("/", deleteImage);
export default router