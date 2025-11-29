import { findById, update } from "../../DB/db.services.js";
import userModel from "../../DB/models/User.model.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { cloud, uploadfile } from "../../utils/cloudinary.js";
import { successResponce } from "../../utils/Response.js";

export const uploadImage = asyncHandler(async (req, res, next) => {
    // Check if file exists
    if (!req.file) {
        next(new Error("No file uploaded", { cause: 400 }))
        return
    }

    if (!req.body.id) {
        next(new Error("there is no id", { cause: 400 }))
        return
    }

    const findUser = await findById({ model: userModel, id: req.body.id })

    if (!findUser) {
        next(new Error("User not found", { cause: 404 }));
        return
    }

    try {
        // Upload to Cloudinary
        const result = await uploadfile({ 
            buffer: req.file.buffer, 
            filePath: `user-profiles/${req.body.id}`
        });

        // Update user profile picture
        const updatedUser = await update({
            model: userModel,
            filter: { _id: req.body.id },
            data: { profilePic: result.url },
            options: { new: true }
        });

        return successResponce({
            res,
            message: "Profile picture updated successfully",
            data: {
                user: {
                    _id: updatedUser._id,
                    firstName: updatedUser.firstName,
                    email: updatedUser.email,
                    profilePic: updatedUser.profilePic
                },
                image: result
            }
        });

    } catch (error) {
        console.error("Image upload error:", error);
        return next(new Error(`Image upload failed: ${error.message}`, { cause: 500 }));
    }
});

export const deleteImage = asyncHandler(async (req, res, next) => {
    const { imageUrl } = req.body;
    const { id } = req.body; // User ID

    // Validate input
    if (!imageUrl) {
        return next(new Error("Image URL is required", { cause: 400 }));
    }

    if (!id) {
        return next(new Error("User ID is required", { cause: 400 }));
    }

    // Verify user exists
    const findUser = await findById({ model: userModel, id });

    if (!findUser) {
        return next(new Error("User not found", { cause: 404 }));
    }

    try {
        // Extract public_id from Cloudinary URL
        // URL format: https://res.cloudinary.com/{cloud_name}/image/upload/v{version}/{public_id}.{format}
        const urlParts = imageUrl.split('/');
        const uploadIndex = urlParts.indexOf('upload');
        
        if (uploadIndex === -1) {
            return next(new Error("Invalid Cloudinary URL", { cause: 400 }));
        }

        // Get everything after 'upload/v{version}/'
        const publicIdWithFormat = urlParts.slice(uploadIndex + 2).join('/');
        // Remove file extension
        const publicId = publicIdWithFormat.substring(0, publicIdWithFormat.lastIndexOf('.'));

        // Delete from Cloudinary
        const result = await cloud().uploader.destroy(publicId);

        if (result.result !== 'ok' && result.result !== 'not found') {
            return next(new Error("Failed to delete image from Cloudinary", { cause: 500 }));
        }

        // Update user to remove profile picture
        const updatedUser = await update({
            model: userModel,
            filter: { _id: id },
            data: { profilePic: null },
            options: { new: true }
        });

        return successResponce({
            res,
            message: "Profile picture deleted successfully",
            data: {
                user: {
                    _id: updatedUser._id,
                    firstName: updatedUser.firstName,
                    email: updatedUser.email,
                    profilePic: updatedUser.profilePic
                },
                deletionResult: result
            }
        });

    } catch (error) {
        console.error("Image deletion error:", error);
        return next(new Error(`Image deletion failed: ${error.message}`, { cause: 500 }));
    }
});