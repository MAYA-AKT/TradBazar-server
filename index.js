const { MongoClient, ServerApiVersion, ObjectId, Timestamp } = require('mongodb');
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config();
const cookieParser = require('cookie-parser')
// firebase token verify
const admin = require("firebase-admin");
const serviceAccount = require("./tradbazar-firebase-adminsdk-fbsvc-5a17141fc1.json");
// stripe
const stripe = require('stripe')(process.env.STRIPE_SK_KEY)


const app = express();
const port = process.env.PORT || 3000;


// vdo conference
const { RtcTokenBuilder, RtcRole } = require("agora-access-token");

// vdo conference

// Middleware
app.use(cors());
app.use(express.json());

// firebase token verify
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});







// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        await client.connect();


        // create db and collection
        const db = client.db('tradbazar');
        const usersCollection = db.collection("users");
        const categoriesCollection = db.collection("categories");
        const productsCollection = db.collection("products");
        const reviewsCollection = db.collection("reviews");
        const ordersCollection = db.collection("orders");
        const couponsCollection = db.collection("coupons");
        const cartCollection = db.collection("cart");
        const notificationsCollection = db.collection("notifications");


        // middlewares
        const verifyFbToken = async (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: 'Unathorized Access' })
            }
            const token = authHeader.split(' ')[1];
            if (!token) {
                return res.status(401).send({ message: 'Unathorized Access' })
            }
            try {

                const decoded = await admin.auth().verifyIdToken(token);
                req.decoded = decoded;
                next();

            } catch (error) {
                return res.status(403).send({ message: 'Forbidden access' })
            }
        }


        // Generate token for Agora video call
        app.get("/getToken", (req, res) => {
            try {
                const { sellerEmail, uid } = req.query;

                if (!sellerEmail || !uid)
                    return res.status(400).json({ msg: "sellerEmail and uid required" });

                if (!process.env.AGORA_APP_ID || !process.env.AGORA_APP_CERTIFICATE)
                    return res.status(500).json({ msg: "Agora credentials not set" });

                const channelName = `seller_${sellerEmail}`;
                const role = RtcRole.PUBLISHER;
                const expirationTimeInSeconds = 3600;
                const currentTimestamp = Math.floor(Date.now() / 1000);
                const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

                const token = RtcTokenBuilder.buildTokenWithUid(
                    process.env.AGORA_APP_ID,
                    process.env.AGORA_APP_CERTIFICATE,
                    channelName,
                    parseInt(uid),
                    role,
                    privilegeExpiredTs
                );

                res.json({ token, channelName });
            } catch (err) {
                console.error(err);
                res.status(500).json({ msg: "Server error", error: err.message });
            }
        });



        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'admin') {
                return res.status(403).send({ message: 'Forbidden  access' })
            }
            next();
        }

        const verifySeller = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email };
            const user = await usersCollection.findOne(query);
            if (!user || user.role !== 'seller') {
                return res.status(403).send({ message: 'Forbidden  access' })
            }
            next();
        }



        // Save and Update User info  
        app.post('/users', async (req, res) => {
            try {

                const { name,
                    email,

                    photo,
                } = req.body;
                const userExist = await usersCollection.findOne({ email });

                if (!!userExist) {
                    const userUpdate = await usersCollection.updateOne({ email }, {
                        $set: { last_logged_in: new Date().toISOString() }
                    });
                    return res.status(200).send({ message: 'User Already Axisted', inserted: false, userUpdate });
                }



                const newUser = {
                    name,
                    email,

                    photo,

                    role: 'user',
                    created_at: new Date().toISOString(),
                    last_logged_in: new Date().toISOString(),

                }
                const result = await usersCollection.insertOne(newUser);

                // ✅ Create notification for new user
                await notificationsCollection.insertOne({
                    userEmail: email,
                    title: "Welcome to Our Marketplace!",
                    message: `Hi ${name}, your account has been created successfully.`,
                    link: "/profile",
                    isRead: false,
                    createdAt: new Date().toISOString(),
                });

                res.status(201).json({
                    message: "User Created successfully",
                    inserted: true,
                    userId: result.insertedId,
                });
            } catch (error) {
                console.error("❌ Error creating user:", error);
                res.status(500).json({
                    message: "Internal server error while creating user",
                    error: error.message,
                });
            }
        });


        // 📍 Get All Users  with Optional Search (admin)
        app.get("/users", async (req, res) => {
            try {
                const { searchText = "", page = 1, limit = 8 } = req.query;

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                let query = { role: { $ne: "admin" } };

                if (searchText) {
                    query = {
                        role: { $ne: "admin" },
                        $or: [
                            { name: { $regex: searchText, $options: "i" } },
                            { email: { $regex: searchText, $options: "i" } },
                        ],
                    };
                }

                const totalUsers = await usersCollection.countDocuments(query);

                const users = await usersCollection
                    .find(query)
                    .skip((pageNum - 1) * pageSize)
                    .limit(pageSize)
                    .toArray();

                const totalPages = Math.ceil(totalUsers / pageSize);

                res.send({
                    users,
                    totalUsers,
                    totalPages,
                    currentPage: pageNum,
                });
            } catch (err) {
                console.error("Error fetching users:", err);
                res.status(500).send({ message: "Server error" });
            }
        });


        // get User Role (only verify token)
        app.get("/user/role", verifyFbToken, async (req, res) => {
            try {
                const { email } = req.query;



                if (!email) {
                    return res.status(400).send({ message: "Email is required" });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).send({ message: "User not found" });
                }

                res.status(200).send({ role: user?.role || 'user' });



            } catch (error) {
                console.error("Error fetching user role:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // get single user 
        app.get("/users/:email", verifyFbToken, async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            res.send(user);
        })

        // delete users by admin
        app.delete("/admin/users/:id", async (req, res) => {
            try {
                const { id } = req.params;

                // Validate MongoDB ObjectId
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ success: false, message: "Invalid user ID" });
                }

                // Attempt to delete the user
                const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount === 0) {
                    return res.status(404).send({ success: false, message: "User not found" });
                }

                // ✅ Success
                res.status(200).send({
                    success: true,
                    message: "User deleted successfully",
                    deletedId: id,
                });
            } catch (error) {
                console.error("Error deleting user:", error);
                res.status(500).send({
                    success: false,
                    message: "Internal Server Error while deleting user",
                    error: error.message,
                });
            }
        })





        // add Category - only admin  (VT , VA)
        app.post("/categories", verifyFbToken, async (req, res) => {
            try {

                const { name, image, description, createdBy } = req.body;
                if (!name) {
                    return res.status(400).json({ message: "Category name is required" });
                }
                const normalizedName = name.trim().toLowerCase();
                const existing = await categoriesCollection.findOne({ name: normalizedName });
                if (existing) {
                    return res.status(409).json({ message: "Category already exists" });
                }

                const newCategory = {
                    name: normalizedName,
                    image,
                    description,
                    createdBy,
                    createdAt: new Date()
                }

                const result = await categoriesCollection.insertOne(newCategory);
                res.status(201).json({
                    message: "Category Create successfully",
                    inserted: true
                });

            } catch (error) {
                console.error("Error adding category:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });



        // get category- for admin and user
        app.get("/categories", async (req, res) => {
            try {
                const { page = 1, limit = 10 } = req.query;

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                const totalCategories = await categoriesCollection.countDocuments();

                const categories = await categoriesCollection
                    .find()
                    .skip((pageNum - 1) * pageSize)
                    .limit(pageSize)
                    .toArray();

                const totalPages = Math.ceil(totalCategories / pageSize);

                res.send({
                    categories,
                    totalCategories,
                    totalPages,
                    currentPage: pageNum,
                });
            } catch (error) {
                console.error("Failed to fetch categories:", error);
                res.status(500).send({ message: "Failed to fetch categories" });
            }
        });

        app.get("/user-categories", async (req, res) => {
            try {
                const categories = await categoriesCollection
                    .find()
                    .limit(16)
                    .toArray();
                res.status(200).send(categories);
            }
            catch (error) {
                console.error("Failed to fetch categories:", error);
                res.status(500).send({ message: "Failed to fetch categories" });
            }

        })

        // edit or update category for admin
        app.put("/category/:id", verifyFbToken, verifyAdmin, async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;
                const result = await categoriesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to update categories" });
            }
        })

        // delete category for admin
        app.delete('/category/:id', verifyFbToken, verifyAdmin, async (req, res) => {
            try {

                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                await categoriesCollection.deleteOne(filter);
                res.status(200).json({ message: "Category deleted successfully" });

            } catch (error) {
                console.log("error on delete category", error);
                res.status(500).send({ message: "faild to delete category" });
            }
        });



        app.post('/products', async (req, res) => {
            try {
                const {
                    name,
                    category,
                    description,
                    quantity,
                    unit,
                    price,
                    image,
                    seller,

                    // AUTHENTICITY FIELDS
                    productType,
                    origin,
                    sellerStory

                } = req.body;

                // 🔐 Basic validation
                if (!name || !category || !price || !seller?.email) {
                    return res.status(400).json({ message: "Missing required fields" });
                }

                // 🧱 Product object
                const newProduct = {
                    name,
                    category,
                    description: description || "",
                    quantity: parseInt(quantity),
                    unit: unit || "pcs",
                    price: parseFloat(price),
                    image,

                    // SELLER INFO
                    seller: {
                        name: seller.name || "Unknown Seller",
                        email: seller.email,
                        district: seller.district || "Unknown",
                    },

                    // AUTHENTICITY & VERIFICATION SYSTEM
                    productType: productType || "Shop",
                    origin: {
                        district: origin?.district || seller.district || "Unknown",
                        village: origin?.village || ""
                    },
                    sellerStory: sellerStory || "",

                    verificationStatus: "pending",
                    verifiedBy: null,

                    // FLAGS
                    isAvailable: true,
                    featured: false,

                    createdAt: new Date()
                };

                const result = await productsCollection.insertOne(newProduct);


                // 1️⃣ Notify Seller
                const sellerNotification = {
                    userEmail: seller.email,
                    title: "Product Submitted",
                    message: `Your product "${name}" has been submitted successfully and is pending admin verification.`,
                    link: `/seller/products`,
                    isRead: false,
                    createdAt: new Date().toISOString(),
                    type: "product-verification",
                };
                await notificationsCollection.insertOne(sellerNotification);

                // 2️⃣ Notify Admin
                const adminEmail = "admin@gmail.com";
                const adminNotification = {
                    userEmail: adminEmail,
                    title: "New Product Submitted",
                    message: `Seller ${seller.name || seller.email} submitted a new product "${name}" for verification.`,
                    link: `/admin/products`,
                    isRead: false,
                    createdAt: new Date().toISOString(),
                    type: "product-verification",
                };
                await notificationsCollection.insertOne(adminNotification);

                res.status(201).json({
                    message: "Product submitted for verification!",
                    insertedId: result.insertedId,
                });

            } catch (error) {
                console.error("Error adding product:", error);
                res.status(500).json({ message: "Internal Server Error" });
            }
        });



        //    admin route
        app.get("/admin/products", async (req, res) => {
            try {
                const { status, search, page = 1, limit = 10 } = req.query;

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                let query = {};

                if (status && status !== "all") {
                    query.verificationStatus = status;
                }

                if (search) {
                    query.name = { $regex: search, $options: "i" };
                }

                const totalProducts = await productsCollection.countDocuments(query);

                const products = await productsCollection
                    .find(query)
                    .skip((pageNum - 1) * pageSize)
                    .limit(pageSize)
                    .toArray();

                const totalPages = Math.ceil(totalProducts / pageSize);

                res.send({
                    products,
                    totalProducts,
                    totalPages,
                    currentPage: pageNum,
                });
            } catch (error) {
                console.error("Error fetching products:", error);
                res.status(500).json({ message: "Internal Server Error" });
            }
        });


        //  product mark as featured true by admin
        app.patch("/admin/products/featured/:id", async (req, res) => {
            try {

                const { id } = req.params;
                const { featured } = req.body;
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });

                if (!product) {
                    return res.status(404).send({ message: "Product not found" });
                }
                if (product.verificationStatus !== "verified") {
                    return res.status(400).send({
                        message: "Only approved products can be featured",
                    });
                }
                await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: { featured }
                    }
                )
                res.status(200).send({
                    success: true,
                    message: featured ? "Product marked as Featured" : "Product unmarked as Featured",
                });

            } catch (error) {
                console.error("Error updating featured status:", error);
                res.status(500).send({
                    success: false,
                    message: "Failed to update featured status",
                    error: error.message,
                });
            }
        })




        // 🧑‍🤝‍🧑 user Top products  route
        app.get("/products/top", async (req, res) => {
            try {
                // Fetch only featured products (or top-rated)
                const topProducts = await productsCollection
                    .find({ featured: true, verificationStatus: "verified" })
                    .limit(12)
                    .toArray();

                res.status(200).send(topProducts);
            } catch (error) {
                console.error("Error fetching top products:", error);
                res.status(500).send({ message: "Failed to load top products" });
            }
        });

        // get products by seller email

        app.get("/products/seller", async (req, res) => {
            try {
                const { email, status, search, page = 1, limit = 8 } = req.query;

                if (!email) {
                    return res.status(400).json({ message: "Seller email is required" });
                }

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                let query = { "seller.email": email };


                if (status && status !== "all") {
                    query.verificationStatus = status;
                }


                if (search) {
                    query.name = { $regex: search, $options: "i" };
                }

                const totalProducts = await productsCollection.countDocuments(query);

                const products = await productsCollection
                    .find(query)
                    .skip((pageNum - 1) * pageSize)
                    .limit(pageSize)
                    .toArray();

                const totalPages = Math.ceil(totalProducts / pageSize);

                res.send({
                    products,
                    totalPages,
                    totalProducts,
                });
            } catch (error) {
                console.error("Error fetching seller products:", error);
                res.status(500).json({ message: "Internal Server Error" });
            }
        });



        // delete myProduct for seller
        app.delete('/myProducts/:id', verifyFbToken, async (req, res) => {
            try {

                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                await productsCollection.deleteOne(filter);
                res.status(200).json({ message: "product deleted successfully" });

            } catch (error) {
                console.log("error on delete product", error);
                res.status(500).send({ message: "faild to delete product" });
            }
        });

        // - update a Myproduct for seller by ID 
        app.patch("/products/:id", verifyFbToken, async (req, res) => {
            try {
                const id = req.params.id;
                const updatedData = req.body;

                const result = await productsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );

                if (result.modifiedCount > 0) {
                    res.status(200).json({ success: true, message: "Product updated successfully", modifiedCount: result.modifiedCount });
                } else {
                    res.status(404).json({ success: false, message: "No product updated. Maybe not found or data unchanged." });
                }
            } catch (error) {
                console.error("Error updating product:", error);
                res.status(500).json({ success: false, message: "Failed to update product" });
            }
        });


        // product status change [verified or reject] by admin
        app.patch("/products/status/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { verificationStatus } = req.body;

                if (!["verified", "rejected", "pending"].includes(verificationStatus)) {
                    return res.status(400).json({ message: "Invalid status value" });
                }

                const filter = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        verificationStatus,
                        verifiedBy: req.user?.email || "admin"
                    }
                }

                const result = await productsCollection.updateOne(filter, updateDoc);

                // send seller notification
                if (result.modifiedCount > 0 && product.seller?.email) {
                    const sellerNotification = {
                        userEmail: product.seller.email, // seller's email
                        title:
                            verificationStatus === "verified"
                                ? "Product Verified ✅"
                                : verificationStatus === "rejected"
                                    ? "Product Rejected ❌"
                                    : "Product Pending ⏳",
                        message:
                            verificationStatus === "verified"
                                ? `Your product "${product.name}" has been verified and is now live on the platform.`
                                : verificationStatus === "rejected"
                                    ? `Your product "${product.name}" has been rejected. Please review and update the product information.`
                                    : `Your product "${product.name}" status is now pending verification.`,
                        link: "/seller/products", // seller dashboard products page
                        isRead: false,
                        createdAt: new Date().toISOString(),
                    };

                    await notificationsCollection.insertOne(sellerNotification);
                }

                if (result.modifiedCount > 0) {
                    res.status(200).json({ success: true, message: `Product ${verificationStatus} successfully` });
                } else {
                    res.status(404).json({ success: false, message: "Product not found or already updated" });
                }

            } catch (error) {
                console.error("Error updating status:", error);
                res.status(500).json({ success: false, message: "Server error while updating status" });
            }
        });


        // users request for (become a seller)
        app.post('/sellers/request', async (req, res) => {
            try {

                const { email, phone, productType, source, district } = req.body;

                const user = await usersCollection.findOne({ email });
                if (!user) return res.status(404).send({ message: "User not found" });

                if (user.sellerRequest && user.sellerRequest.status === "pending") {
                    return res.status(400).send({ message: "Request already submitted", success: false });
                }

                const result = await usersCollection.updateOne({ email },
                    {
                        $set: {
                            sellerRequest: {
                                phone,
                                productType,
                                source,
                                district,
                                status: "pending",
                                date: new Date().toISOString().split("T")[0],
                            }
                        }
                    }
                )

                // send notificaiton to seller

                const userNotification = {
                    userEmail: email,
                    title: "Seller Request Submitted",
                    message: `Hello ${user.name || "User"}, your request to become a seller has been submitted successfully. Please wait for approval.`,
                    link: "/profile/seller-request",
                    isRead: false,
                    createdAt: new Date().toISOString(),
                };
                await notificationsCollection.insertOne(userNotification);

                //send admin notification
                const adminEmail = "admin@gmail.com";

                const adminNotification = {
                    userEmail: adminEmail,
                    title: "New Seller Request",
                    message: `User ${user.name || email} has submitted a request to become a seller. Please review and approve.`,
                    link: "/admin/seller-requests",
                    isRead: false,
                    createdAt: new Date().toISOString(),
                    type: "seller-request",
                };

                await notificationsCollection.insertOne(adminNotification);

                res.status(200).send({
                    success: true,
                    message: "Seller request submitted successfully",
                    result,
                });


            } catch (error) {
                console.error("Error in /seller-request:", error);
                res.status(500).send({
                    success: false,
                    message: "Internal Server Error while submitting seller request",
                    error: error.message,
                });
            }


        });


        // get all seller request (for admin)
        app.get('/admin/seller-requests', async (req, res) => {
            const pendingRequests = await usersCollection
                .find({ "sellerRequest.status": "pending" })
                .toArray();

            res.status(200).send(pendingRequests);

        });


        // approved seller request and update user role as seller
        app.patch(`/admin/seller/update-request/:email`, async (req, res) => {
            try {

                const { email } = req.params;
                const { action } = req.body;

                if (!["approved", "rejected"].includes(action)) {
                    return res.status(400).send({ message: "Invalid action" });
                }

                const user = await usersCollection.findOne({ email });
                if (!user || !user.sellerRequest) {
                    return res.status(404).send({ message: "Seller request not found" });
                }

                const updateData = {
                    "sellerRequest.status": action,
                    "sellerRequest.reviewedAt": new Date().toISOString(),
                };

                // ✅ If approved, make user a seller
                if (action === "approved") {
                    updateData.role = "seller";
                }
                await usersCollection.updateOne(
                    { email },
                    { $set: updateData }
                );

                // ✅ send notification for seller request
                const notification = {
                    userEmail: email,
                    title:
                        action === "approved"
                            ? "Seller Request Approved 🎉"
                            : "Seller Request Rejected",
                    message:
                        action === "approved"
                            ? "Congratulations! Your seller request has been approved. You can now start selling products."
                            : "Unfortunately, your seller request has been rejected. Please review your information and try again.",
                    link: "/profile",
                    isRead: false,
                    createdAt: new Date().toISOString(),
                };
                await notificationsCollection.insertOne(notification);

                res.status(200).send({
                    success: true,
                    message: `Seller request ${action.toLowerCase()} successfully`,
                });

            } catch (error) {
                console.error("Error in /admin/seller-request:", error);
                res.status(500).send({
                    success: false,
                    message: "Internal Server Error while updating seller request",
                    error: error.message,
                });
            }
        });

        // GET products by category
        app.get("/products/category", async (req, res) => {
            try {
                const { name, page = 1, limit = 12 } = req.query;

                if (!name) {
                    return res.status(400).send({ message: "Category name is required" });
                }

                const skip = (parseInt(page) - 1) * parseInt(limit);

                const query = {
                    category: name,
                    verificationStatus: "verified",
                };

                const total = await productsCollection.countDocuments(query);

                const products = await productsCollection
                    .find(query)
                    .skip(skip)
                    .limit(parseInt(limit))
                    .toArray();

                res.status(200).send({
                    products,
                    total,
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                });
            } catch (error) {
                console.error("Error fetching category products:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });



        // get one product by id for user
        app.get("/product/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const product = await productsCollection.findOne({ _id: new ObjectId(id) });

                if (!product) {
                    return res.status(404).send({ message: "Product not found" });
                }

                res.send(product);
            } catch (error) {
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        // save review in db
        app.post("/reviews", async (req, res) => {
            try {
                const { productId, userEmail, rating, comment, sellerEmail } = req.body;


                // Check if user exists
                const user = await usersCollection.findOne({ email: userEmail });
                if (!user) {
                    return res.status(404).send({ message: "User not found" });
                }

                const newReview = {
                    productId,
                    userEmail,
                    userName: user.name,
                    sellerEmail,
                    avatar: user.photo || "https://i.ibb.co/8jD0P1M/default-avatar.png",
                    rating: parseInt(rating),
                    comment,
                    date: new Date().toISOString().split("T")[0],
                };

                const result = await reviewsCollection.insertOne(newReview);

                // 🔔 Notify Seller about new review
                if (sellerEmail) {
                    const sellerNotification = {
                        userEmail: sellerEmail,
                        title: "New Product Review",
                        message: `${user.name} left a ${rating}⭐ review on your product.`,
                        link: `/seller/reviews?productId=${productId}`,
                        isRead: false,
                        createdAt: new Date().toISOString(),
                        type: "review",
                    };

                    await notificationsCollection.insertOne(sellerNotification);
                }

                res.send(result);

            } catch (error) {
                console.error("Error adding review:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

        // get all reviews 
        app.get("/reviews/:productId", async (req, res) => {
            try {
                const { productId } = req.params;

                const reviews = await reviewsCollection
                    .find({ productId })
                    .sort({ date: -1 })
                    .toArray();

                res.send(reviews);
            } catch (error) {
                console.error("Error fetching reviews:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });



        app.post("/orders", async (req, res) => {
            try {
                const { orders } = req.body;
                console.log('orders ', orders);

                if (!orders || !orders.length) {
                    return res.status(400).send({ message: "No orders provided" });
                }

                const insertedOrders = [];

                for (const o of orders) {
                    const {
                        userEmail, productId, quantity, grandTotal, totalPrice,
                        shippingCost, address, phone, district, area, sellerInfo,
                        paymentMethod, paymentStatus, transactionId
                    } = o;

                    if (!userEmail || !productId || !quantity || !grandTotal) {
                        return res.status(400).send({ message: "Missing required order fields" });
                    }

                    const order = {
                        userEmail, productId, quantity, totalPrice, shippingCost,
                        grandTotal, address, phone, district, area, sellerInfo,
                        paymentMethod: paymentMethod || "COD",
                        paymentStatus: paymentStatus || "pending",
                        transactionId: transactionId || null,
                        orderStatus: "pending",
                        createdAt: new Date().toISOString(),
                    };

                    const result = await ordersCollection.insertOne(order);

                    await productsCollection.updateOne(
                        { _id: new ObjectId(productId) },
                        { $inc: { quantity: -quantity } }
                    );

                    // --- Create notification for user ---
                    const notification = {
                        userEmail,
                        title: "Order Confirmed",
                        message: `Hello ${o.userName || "User"}, your order  has been confirmed! You can now track your parcel.`,
                        link: `/myOrders`,
                        isRead: false,
                        createdAt: new Date().toISOString(),
                    };
                    await notificationsCollection.insertOne(notification);
                    //    selelr notification


                    if (sellerInfo?.email) {
                        const sellerNotification = {
                            userEmail: sellerInfo.email,
                            title: "New Order Received",
                            message: `Hello ${sellerInfo.name || "Seller"}, you have received a new order for your product "${o.productName || "Product"}".`,
                            link: `/seller/orders`, // seller dashboard order page
                            isRead: false,
                            createdAt: new Date().toISOString(),
                        };
                        await notificationsCollection.insertOne(sellerNotification);
                    }



                    insertedOrders.push(result.insertedId);
                }

                res.status(201).send({ success: true, message: "Orders placed", orderIds: insertedOrders });
            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });


        // Stripe payment
        app.post("/create-payment-intent", async (req, res) => {
            const { amount } = req.body;

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount * 100,
                    currency: "bdt",
                    payment_method_types: ["card"],
                });

                res.send({
                    clientSecret: paymentIntent.client_secret,
                });
            } catch (error) {
                res.status(500).send({ error: error.message });
            }
        });


        // save coupon

        app.post("/coupons", async (req, res) => {
            try {
                const { code, discount, type, minAmount, expired, createdAt } = req.body;


                if (!code || !discount || !type) {
                    return res.status(400).send({
                        success: false,
                        message: "Missing required fields",
                    });
                }


                const exists = await couponsCollection.findOne({ code });
                if (exists) {
                    return res.status(400).send({
                        success: false,
                        message: "Coupon with this code already exists",
                    });
                }


                const newCoupon = {
                    code: code.toUpperCase().trim(),
                    discount: Number(discount),
                    type,
                    minAmount: minAmount ? Number(minAmount) : 0,
                    expired: expired || false,
                    createdAt: createdAt || new Date().toISOString(),
                };


                await couponsCollection.insertOne(newCoupon);

                res.status(201).send({
                    success: true,
                    message: "Coupon created successfully",
                    coupon: newCoupon,
                });

            } catch (err) {
                console.error("Coupon creation error:", err);
                res.status(500).send({
                    success: false,
                    message: "Internal Server Error",
                });
            }
        });



        // GET /coupons
        app.get("/coupons", async (req, res) => {
            try {
                const { search = "", page = 1, limit = 10 } = req.query;

                const query = search
                    ? { code: { $regex: search, $options: "i" } }
                    : {};

                const skip = (parseInt(page) - 1) * parseInt(limit);


                const totalCoupons = await couponsCollection.countDocuments(query);


                const coupons = await couponsCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(parseInt(limit))
                    .toArray();

                const totalPages = Math.ceil(totalCoupons / limit);

                res.send({
                    success: true,
                    coupons,
                    totalPages,
                    currentPage: parseInt(page),
                    totalCoupons,
                });
            } catch (err) {
                console.error("Error fetching coupons:", err);
                res.status(500).send({ success: false, message: "Internal Server Errorr" });
            }
        });


        // POST /validate-coupon
        app.post("/validate-coupon", async (req, res) => {
            try {
                const { code, totalAmount } = req.body;

                if (!code || totalAmount == null) {
                    return res.status(400).send({
                        success: false,
                        message: "Coupon code and total amount are required",
                    });
                }


                const coupon = await couponsCollection.findOne({ code: code.toUpperCase() });
                if (!coupon) {
                    return res.send({ success: false, message: "Invalid coupon code" });
                }


                if (coupon.expired) {
                    return res.send({ success: false, message: "This coupon is expired" });
                }


                if (coupon.minAmount && totalAmount < coupon.minAmount) {
                    return res.send({
                        success: false,
                        message: `Minimum order amount for this coupon is ${coupon.minAmount}৳`,
                    });
                }


                let discountAmount = 0;
                if (coupon.type === "percent") {
                    discountAmount = (totalAmount * coupon.discount) / 100;
                } else if (coupon.type === "flat") {
                    discountAmount = coupon.discount;
                }


                if (discountAmount > totalAmount) discountAmount = totalAmount;

                res.send({
                    success: true,
                    discountAmount,
                    message: "Coupon applied successfully",
                });
            } catch (err) {
                console.error("Coupon validation error:", err);
                res.status(500).send({
                    success: false,
                    message: "Internal server error",
                });
            }
        });

        // PUT -edit /coupons/:id
        app.put("/coupons/:id", async (req, res) => {
            try {
                const { id } = req.params;
                const { code, discount, type, minAmount, expired } = req.body;

                if (!code || !discount || !type) {
                    return res.status(400).send({ success: false, message: "Missing required fields" });
                }

                const updated = await couponsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $set: {
                            code,
                            discount,
                            type,
                            minAmount,
                            expired,
                        },
                    }
                );

                if (updated.matchedCount === 0) {
                    return res.status(404).send({ success: false, message: "Coupon not found" });
                }

                res.send({ success: true, message: "Coupon updated successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: "Server error" });
            }
        });

        // DELETE /coupons/:id
        app.delete("/coupons/:id", async (req, res) => {
            try {
                const { id } = req.params;

                const deleted = await couponsCollection.deleteOne({ _id: new ObjectId(id) });

                if (deleted.deletedCount === 0) {
                    return res.status(404).send({ success: false, message: "Coupon not found" });
                }

                res.send({ success: true, message: "Coupon deleted successfully" });
            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: "Server error" });
            }
        });


        // GET /buyer/orders?email=user@gmail.com&page=1&limit=10
        app.get("/buyer/orders", async (req, res) => {
            try {
                const { email, page = 1, limit = 10 } = req.query;

                if (!email) {
                    return res.status(400).send({
                        success: false,
                        message: "Email is required",
                    });
                }

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                const query = { userEmail: email };

                const totalOrders = await ordersCollection.countDocuments(query);

                const orders = await ordersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip((pageNum - 1) * pageSize)
                    .limit(pageSize)
                    .toArray();

                res.send({
                    success: true,
                    orders,
                    totalPages: Math.ceil(totalOrders / pageSize),
                });

            } catch (err) {
                console.error(err);
                res.status(500).send({ success: false, message: "Server error" });
            }
        });




        // GET /admin/orders?search=&status=&page=1&limit=10
        app.get("/admin/orders", async (req, res) => {
            try {
                const { search = "", status, page = 1, limit = 10 } = req.query;

                const query = {};

                if (search) {
                    query.userEmail = { $regex: search, $options: "i" }; // search by email
                }

                if (status) {
                    query.orderStatus = status;
                }

                const skip = (page - 1) * limit;

                const orders = await ordersCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip(parseInt(skip))
                    .limit(parseInt(limit))
                    .toArray();

                const totalOrders = await ordersCollection.countDocuments(query);
                const totalPages = Math.ceil(totalOrders / limit);

                res.send({ success: true, orders, totalPages });
            } catch (err) {
                console.error("Admin orders fetch error:", err);
                res.status(500).send({ success: false, message: "Internal Server Error" });
            }
        });

        // PATCH /admin/orders/:orderId
        app.patch("/admin/orders/:orderId", async (req, res) => {
            try {
                const { orderId } = req.params;
                const { status } = req.body;

                if (!status) {
                    return res.status(400).send({ success: false, message: "Status is required" });
                }



                const order = await ordersCollection.findOne({
                    _id: new ObjectId(orderId)
                });

                if (!order) {
                    return res.status(404).send({ success: false, message: "Order not found" });
                }

                // Update orderStatus in the database
                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: { orderStatus: status } }
                );


                if (result.modifiedCount === 0) {
                    return res.status(404).send({ success: false, message: "Order not found or status unchanged" });
                }

                // 2️⃣ Notify buyer
                const buyerNotification = {
                    userEmail: order.userEmail,
                    title: "Order Status Updated",
                    message: `Your order status is now "${status}". Track your order for live updates.`,
                    link: `/track-order/${orderId}`,
                    isRead: false,
                    createdAt: new Date().toISOString(),
                    type: "order-tracking",
                };
                await notificationsCollection.insertOne(buyerNotification);

                // 3️⃣ Notify seller
                if (order.sellerInfo?.email) {
                    const sellerNotification = {
                        userEmail: order.sellerInfo.email,
                        title: "Order Status Updated",
                        message: `The order for your product(s) has been updated to "${status}". Check your seller dashboard for details.`,
                        link: `/seller/orders`, // seller dashboard orders page
                        isRead: false,
                        createdAt: new Date().toISOString(),
                        type: "order-tracking",
                    };
                    await notificationsCollection.insertOne(sellerNotification);
                }

                res.send({ success: true, message: "Order status updated successfully" });
            } catch (err) {
                console.error("Error updating order status:", err);
                res.status(500).send({ success: false, message: "Internal server error" });
            }
        });


        // GET /seller/orders?sellerEmail=abc@example.com&page=1&limit=5


        app.get("/seller/orders", async (req, res) => {
            try {
                const { sellerEmail, page = 1, limit = 10 } = req.query;

                if (!sellerEmail) {
                    return res.status(400).send({
                        success: false,
                        message: "Seller email is required",
                    });
                }

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                if (isNaN(pageNum) || isNaN(pageSize)) {
                    return res.status(400).send({
                        success: false,
                        message: "Page and limit must be numbers",
                    });
                }

                const matchStage = { "sellerInfo.email": sellerEmail };


                const totalOrders = await ordersCollection.countDocuments(matchStage);
                const totalPages = Math.ceil(totalOrders / pageSize);


                const orders = await ordersCollection.aggregate([
                    { $match: matchStage },


                    {
                        $addFields: {
                            productObjectId: { $toObjectId: "$productId" }
                        }
                    },

                    {
                        $lookup: {
                            from: "products",
                            localField: "productObjectId",
                            foreignField: "_id",
                            as: "productInfo"
                        }
                    },

                    {
                        $unwind: {
                            path: "$productInfo",
                            preserveNullAndEmptyArrays: true
                        }
                    },

                    {
                        $project: {
                            _id: 1,
                            userEmail: 1,
                            productId: 1,
                            quantity: 1,
                            grandTotal: 1,
                            paymentStatus: { $ifNull: ["$paymentStatus", "pending"] },
                            paymentMethod: 1,
                            orderStatus: 1,
                            createdAt: 1,

                            // product info
                            productName: { $ifNull: ["$productInfo.name", "Product Removed"] },
                            productImage: "$productInfo.image"
                        }
                    },

                    { $sort: { createdAt: -1 } },
                    { $skip: (pageNum - 1) * pageSize },
                    { $limit: pageSize }
                ]).toArray();

                res.send({
                    success: true,
                    orders,
                    totalPages,
                });

            } catch (err) {
                console.error("Error fetching seller orders:", err);
                res.status(500).send({
                    success: false,
                    message: "Server error",
                });
            }
        });




        // app.get("/seller/orders", async (req, res) => {
        //     try {
        //         const { sellerEmail, page = 1, limit = 10 } = req.query;

        //         if (!sellerEmail) {
        //             return res.status(400).send({
        //                 success: false,
        //                 message: "Seller email is required",
        //             });
        //         }

        //         const pageNum = parseInt(page);
        //         const pageSize = parseInt(limit);

        //         const query = { "sellerInfo.email": sellerEmail };

        //         // Total orders for pagination
        //         const totalOrders = await ordersCollection.countDocuments(query);
        //         const totalPages = Math.ceil(totalOrders / pageSize);

        //         // Aggregation to join product info
        //         const orders = await ordersCollection.aggregate([
        //             { $match: query },

        //             // Convert string productId to ObjectId for lookup
        //             {
        //                 $addFields: {
        //                     productObjectId: { $toObjectId: "$productId" }
        //                 }
        //             },

        //             // Join with products collection
        //             {
        //                 $lookup: {
        //                     from: "products",        // name of your products collection
        //                     localField: "productObjectId",
        //                     foreignField: "_id",
        //                     as: "product"
        //                 }
        //             },

        //             // Flatten the product array
        //             { $unwind: "$product" },

        //             // Optional: sort by creation date
        //             { $sort: { createdAt: -1 } },

        //             // Pagination
        //             { $skip: (pageNum - 1) * pageSize },
        //             { $limit: pageSize },

        //             // Return only needed fields
        //             {
        //                 $project: {
        //                     _id: 1,
        //                     productId: 1,
        //                     productName: "$product.name",
        //                     productImage: "$product.image",
        //                     quantity: 1,
        //                     grandTotal: 1,
        //                     paymentStatus: 1,
        //                     createdAt: 1
        //                 }
        //             }
        //         ]).toArray();

        //         res.send({
        //             success: true,
        //             orders,
        //             totalPages
        //         });
        //     } catch (err) {
        //         console.error("Error fetching seller orders:", err);
        //         res.status(500).send({
        //             success: false,
        //             message: "Server error",
        //         });
        //     }
        // });




        // SELLER updates order to shipped
        app.patch("/seller/orders/:orderId", async (req, res) => {
            try {
                const { orderId } = req.params;
                const { trackingId, courierName } = req.body;


                const order = await ordersCollection.findOne({
                    _id: new ObjectId(orderId)
                });

                if (!order) {
                    return res.status(404).send({ success: false, message: "Order not found" });
                }


                if (!trackingId || !courierName) {
                    return res.status(400).send({
                        success: false,
                        message: "Tracking ID and courier name are required"
                    });
                }

                const updateData = {
                    orderStatus: "shipped",
                    shippedAt: new Date(),
                    trackingId,
                    courierName,
                };

                const result = await ordersCollection.updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: updateData }
                );




                if (result.modifiedCount === 0) {
                    return res.status(404).send({
                        success: false,
                        message: "Order not found"
                    });
                }

                // send notification/email to user here
                const notification = {
                    userEmail: order.userEmail,
                    title: "Order Status Updated",
                    message: `Your order status is now "${updateData.orderStatus}". Track your order for live updates.`,
                    link: `/track-order/${orderId}`,
                    isRead: false,
                    createdAt: new Date().toISOString(),
                    type: "order-tracking",
                };
                await notificationsCollection.insertOne(notification);
                // --- Notification for Admin ---
                const adminEmail = "admin@gmail.com";
                const adminNotification = {
                    userEmail: adminEmail,
                    title: "Order Shipped",
                    message: `Seller ${order.sellerInfo?.name || order.sellerInfo?.email} has marked order ${orderId} as shipped.`,
                    link: `/admin/orders`,
                    isRead: false,
                    createdAt: new Date().toISOString(),
                    type: "order-tracking",
                };
                await notificationsCollection.insertOne(adminNotification);
                res.send({
                    success: true,
                    message: "Order shipped successfully",
                });

            } catch (err) {
                console.error(err);
                res.status(500).send({
                    success: false,
                    message: "Server error"
                });
            }
        });

        // GET /buyer/order/:orderId (get order status for tracking )
        app.get("/buyer/order/:orderId", async (req, res) => {
            try {
                const { orderId } = req.params;

                const order = await ordersCollection.findOne({
                    _id: new ObjectId(orderId),
                });

                if (!order) {
                    return res.status(404).send({
                        success: false,
                        message: "Order not found",
                    });
                }

                res.send({
                    success: true,
                    order,
                });

            } catch (err) {
                console.error(err);
                res.status(500).send({
                    success: false,
                    message: "Server error",
                });
            }
        });


        // cart section add cart

        app.post("/cart", async (req, res) => {
            try {
                const { userEmail, productId, name, image, price, seller } = req.body;

                if (!userEmail || !productId) {
                    return res.status(400).send({ message: "Invalid data" });
                }

                const existingItem = await cartCollection.findOne({
                    userEmail,
                    productId
                });

                // If product already exists → increase quantity
                if (existingItem) {
                    await cartCollection.updateOne(
                        { _id: existingItem._id },
                        { $inc: { quantity: 1 } }
                    );
                    return res.send({ message: "Cart quantity updated" });
                }

                // Else add new product
                await cartCollection.insertOne({
                    userEmail,
                    productId,
                    name,
                    image,
                    price,
                    quantity: 1,
                    seller,
                    createdAt: new Date()
                });

                res.send({ message: "Product added to cart" });
            } catch (err) {
                res.status(500).send({ message: "Server error" });
            }
        });

        // get cart products count
        app.get("/cart/count", async (req, res) => {
            const { email } = req.query;

            const count = await cartCollection.countDocuments({
                userEmail: email
            });

            res.send({ count });
        });

        // get cart items
        app.get("/cart", async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: "Email required" });
                }

                const cartItems = await cartCollection
                    .find({ userEmail: email })
                    .toArray();



                res.send({ cartItems });
            } catch (error) {
                console.error("Cart fetch error:", error);
                res.status(500).send({ message: "Server error" });
            }
        });

        // PATCH /cart/:id
        app.patch("/cart/:id", async (req, res) => {
            const { action } = req.body;
            const id = req.params.id;

            const cartItem = await cartCollection.findOne({ _id: new ObjectId(id) });

            if (!cartItem) {
                return res.status(404).send({ message: "Cart item not found" });
            }

            let newQty = cartItem.quantity;

            if (action === "inc") newQty += 1;
            if (action === "dec" && newQty > 1) newQty -= 1;

            await cartCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { quantity: newQty } }
            );

            res.send({ success: true });
        });

        // DELETE /cart/:id
        app.delete("/cart/:id", async (req, res) => {
            const id = req.params.id;

            await cartCollection.deleteOne({ _id: new ObjectId(id) });

            res.send({ success: true });
        });


        // get notificatons
        app.get("/notifications/:email", async (req, res) => {
            const email = req.params.email;
            try {
                const notifications = await notificationsCollection
                    .find({ userEmail: email })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.json(notifications);
            } catch (err) {
                console.error(err);
                res.status(500).json({ message: "Failed to fetch notifications" });
            }
        });

        app.patch("/notifications/read/:id", async (req, res) => {
            const id = req.params.id;
            try {
                await notificationsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { isRead: true } }
                );
                res.json({ success: true });
            } catch (err) {
                console.error(err);
                res.status(500).json({ success: false, message: "Failed to update notification" });
            }
        });

        // seller earning 
        app.get("/seller/earnings-summary", async (req, res) => {
            try {
                const { sellerEmail } = req.query;

                if (!sellerEmail) {
                    return res.status(400).send({
                        success: false,
                        message: "Seller email is required",
                    });
                }

                const result = await ordersCollection.aggregate([
                    { $match: { "sellerInfo.email": sellerEmail } },
                    {
                        $group: {
                            _id: null,
                            totalOrders: { $sum: 1 },

                            // ✅ Seller total earnings (NO shipping)
                            totalEarnings: { $sum: "$totalPrice" },

                            // ✅ Paid earnings only
                            paidEarnings: {
                                $sum: {
                                    $cond: [
                                        { $eq: ["$paymentStatus", "paid"] },
                                        "$totalPrice",
                                        0
                                    ]
                                }
                            },

                            // ✅ Pending earnings
                            pendingEarnings: {
                                $sum: {
                                    $cond: [
                                        { $ne: ["$paymentStatus", "paid"] },
                                        "$totalPrice",
                                        0
                                    ]
                                }
                            }
                        }
                    }
                ]).toArray();

                res.send({
                    success: true,
                    data: result[0] || {
                        totalOrders: 0,
                        totalEarnings: 0,
                        paidEarnings: 0,
                        pendingEarnings: 0,
                    }
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ success: false, message: "Server error" });
            }
        });





        app.get("/seller/orders-summary", async (req, res) => {
            try {
                const { sellerEmail, page = 1, limit = 6, status } = req.query;

                if (!sellerEmail) {
                    return res.status(400).send({ message: "Seller email required" });
                }

                const pageNum = parseInt(page);
                const pageSize = parseInt(limit);

                // ✅ SAME FILTER FOR BOTH COUNT & DATA
                const matchStage = {
                    "sellerInfo.email": sellerEmail,
                };

                if (status && status !== "All") {
                    matchStage.paymentStatus = status.toLowerCase();
                }

                // ✅ TOTAL COUNT (THIS WAS MISSING)
                const totalOrders = await ordersCollection.countDocuments(matchStage);
                const totalPages = Math.ceil(totalOrders / pageSize);

                // ✅ PAGINATED DATA
                const orders = await ordersCollection.aggregate([
                    { $match: matchStage },

                    {
                        $addFields: {
                            productObjectId: { $toObjectId: "$productId" }
                        }
                    },

                    {
                        $lookup: {
                            from: "products",
                            localField: "productObjectId",
                            foreignField: "_id",
                            as: "productInfo"
                        }
                    },

                    {
                        $unwind: {
                            path: "$productInfo",
                            preserveNullAndEmptyArrays: true
                        }
                    },

                    {
                        $project: {
                            _id: 1,
                            grandTotal: 1,
                            paymentStatus: { $ifNull: ["$paymentStatus", "pending"] },
                            createdAt: 1,
                            productName: { $ifNull: ["$productInfo.name", "Product Removed"] },
                            productImage: "$productInfo.image"
                        }
                    },

                    { $sort: { createdAt: -1 } },
                    { $skip: (pageNum - 1) * pageSize },
                    { $limit: pageSize }
                ]).toArray();

                res.send({
                    success: true,
                    orders,
                    totalOrders,   // ✅ NEW
                    totalPages     // ✅ NEW
                });

            } catch (err) {
                console.error("Error fetching seller orders summary:", err);
                res.status(500).send({ message: "Server error" });
            }
        });




        app.get("/seller/earnings-by-date", async (req, res) => {
            try {
                const { sellerEmail, month, year } = req.query;

                if (!sellerEmail || !month || !year) {
                    return res.status(400).send({ success: false });
                }

                const m = parseInt(month);
                const y = parseInt(year);

                const earnings = await ordersCollection.aggregate([
                    {
                        $addFields: {
                            createdAtDate: { $toDate: "$createdAt" } // ✅ convert string to Date
                        }
                    },
                    {
                        $match: {
                            "sellerInfo.email": sellerEmail,
                            paymentStatus: "paid", // lowercase (your DB)
                            createdAtDate: {
                                $gte: new Date(y, m - 1, 1),
                                $lt: new Date(y, m, 1)
                            }
                        }
                    },
                    {
                        $group: {
                            _id: { day: { $dayOfMonth: "$createdAtDate" } },
                            total: { $sum: "$totalPrice" }
                        }
                    },
                    { $sort: { "_id.day": 1 } }
                ]).toArray();

                res.send({ success: true, earnings });
            } catch (error) {
                console.error(error);
                res.status(500).send({ success: false });
            }
        });

        // seller dashboar overview
        app.get("/seller/overview", async (req, res) => {
            try {
                const sellerEmail = req.query.email;

                if (!sellerEmail) {
                    return res.status(400).send({ message: "Seller email is required" });
                }


                const products = await productsCollection
                    .find({ "seller.email": sellerEmail })
                    .toArray();

                const productsCount = products.length;

                const lowStockProducts = products.filter((p) => p.quantity <= 5); // threshold = 5


                const orders = await ordersCollection
                    .find({ "sellerInfo.email": sellerEmail })
                    .toArray();

                const ordersCount = orders.length;


                const totalEarnings = orders
                    .filter(
                        (o) =>
                            o.orderStatus === "delivered" &&
                            ((o.paymentMethod === "Card" && o.paymentStatus === "paid") ||
                                o.paymentMethod === "COD")
                    )
                    .reduce((sum, o) => sum + (o.grandTotal || 0), 0);


                const productIds = products.map((p) => p._id.toString());
                const reviews = await reviewsCollection
                    .find({ productId: { $in: productIds } })
                    .toArray();

                const reviewsCount = reviews.length;


                const recentOrders = orders
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .slice(0, 5);


                let topProduct = null;
                if (orders.length > 0) {
                    const productSales = {};
                    orders.forEach((o) => {
                        const pid = o.productId;
                        if (!productSales[pid]) productSales[pid] = 0;
                        productSales[pid] += o.quantity;
                    });
                    const topProductId = Object.keys(productSales).reduce((a, b) =>
                        productSales[a] > productSales[b] ? a : b
                    );
                    topProduct = products.find((p) => p._id.toString() === topProductId) || null;
                }

                res.status(200).send({
                    productsCount,
                    lowStockProducts,
                    ordersCount,
                    totalEarnings,
                    reviewsCount,
                    recentOrders,
                    topProduct,
                });
            } catch (error) {
                console.error("Error fetching seller overview:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });


        // top selling products
        app.get("/top-selling", async (req, res) => {
            try {
                const result = await ordersCollection.aggregate([
                    { $match: { paymentStatus: "paid" } },

                    {
                        $addFields: {
                            productObjectId: { $toObjectId: "$productId" }
                        }
                    },

                    {
                        $group: {
                            _id: "$productObjectId",
                            totalSold: { $sum: "$quantity" }
                        }
                    },

                    { $sort: { totalSold: -1 } },
                    { $limit: 6 },

                    {
                        $lookup: {
                            from: "products",
                            localField: "_id",
                            foreignField: "_id",
                            as: "product"
                        }
                    },

                    { $unwind: "$product" },

                    { $match: { "product.isAvailable": true } },

                    {
                        $project: {
                            _id: 0,
                            totalSold: 1,
                            product: 1
                        }
                    }
                ]).toArray();

                res.json(result);
            } catch (error) {
                console.error(error);
                res.status(500).json({ message: "Failed to fetch top selling products" });
            }
        });


































        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);














// Test route
app.get("/", (req, res) => {
    res.send("🚚 TradBazar is runnig now");
});




app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});

