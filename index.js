const { MongoClient, ServerApiVersion, ObjectId, Timestamp } = require('mongodb');
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config();
const cookieParser = require('cookie-parser')
// firebase token verify
const admin = require("firebase-admin");
const serviceAccount = require("./tradbazar-firebase-adminsdk-fbsvc-5a17141fc1.json");


const app = express();
const port = process.env.PORT || 3000;


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
                    district } = req.body;



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
                    district,
                    role: 'user',
                    created_at: new Date().toISOString(),
                    last_logged_in: new Date().toISOString(),

                }
                const result = await usersCollection.insertOne(newUser)
                res.status(201).json({
                    message: "User Create successfully",
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

                res.status(200).send({ role: user.role || 'user' });

            } catch (error) {
                console.error("Error fetching user role:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });

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
                const categories = await categoriesCollection.find().toArray();
                res.send(categories);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch categories" });
            }
        });


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


        // add products for seller 
        app.post('/products', verifyFbToken, verifySeller, async (req, res) => {
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
                    status,
                    isAvailable,
                    featured
                } = req.body;

                //  Check for duplicate product (optional but recommended)
                const existing = await productsCollection.findOne({
                    name: { $regex: new RegExp(`^${name}$`, "i") }, // case-insensitive match
                    "seller.email": seller.email,
                });

                if (existing) {
                    return res.status(409).json({
                        message: "A product with this name already exists from this seller.",
                    });
                }

                //   add product in db
                const newProduct = {
                    name,
                    category,
                    description: description || "",
                    quantity: parseInt(quantity),
                    unit: unit || "pcs",
                    price: parseFloat(price),
                    image,
                    seller: {
                        name: seller.name || "Unknown Seller",
                        email: seller.email,
                        district: seller.district || "Unknown",
                    },
                    status: status || "pending", // default if not provided
                    isAvailable: true,
                    featured: false,
                    createdAt: new Date().toISOString(),
                };
                const result = await productsCollection.insertOne(newProduct);

                // ✅ 5️⃣ Send success response
                res.status(201).json({
                    message: "Product added successfully!",
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
                const { status, search } = req.query;

                let query = {};

                if (status && status !== "All") {
                    query.status = status;
                }

                if (search) {
                    query.name = { $regex: search, $options: "i" }; // case-insensitive search
                }

                const products = await productsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                console.error("Error fetching products:", error);
                res.status(500).json({ message: "Internal Server Error" });
            }
        });

        // 🧑‍🤝‍🧑 Public route
        // app.get("/products", async (req, res) => {
        //     const products = await productsCollection.find().toArray();
        //     res.send(products);
        // });


        // get products by seller email
        app.get("/products/seller", async (req, res) => {
            try {
                const { email, status, search } = req.query;

                if (!email) {
                    return res.status(400).json({ message: "Seller email is required" });
                }

                let query = { "seller.email": email }; // match products created by that seller

                // ✅ Filter by status if not "All"
                if (status && status !== "All") {
                    query.status = status;
                }

                // ✅ Search by product name (case-insensitive)
                if (search) {
                    query.name = { $regex: search, $options: "i" };
                }

                const products = await productsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                console.error("Error fetching seller products:", error);
                res.status(500).json({ message: "Internal Server Error" });
            }
        });


        // delete myProduct for seller
        app.delete('/myProducts/:id', verifyFbToken, verifySeller, async (req, res) => {
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
        app.patch("/products/:id", verifyFbToken, verifySeller, async (req, res) => {
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


        // product status change [approved or reject] by admin
        app.patch("/products/status/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { status } = req.body;

                if (!["Approved", "Rejected", "Pending"].includes(status)) {
                    return res.status(400).json({ message: "Invalid status value" });
                }

                const filter = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        status
                    }
                }

                const result = await productsCollection.updateOne(filter, updateDoc);
                if (result.modifiedCount > 0) {
                    res.status(200).json({ success: true, message: `Product ${status} successfully` });
                } else {
                    res.status(404).json({ success: false, message: "Product not found or already updated" });
                }

            } catch (error) {
                console.error("Error updating status:", error);
                res.status(500).json({ success: false, message: "Server error while updating status" });
            }
        });








        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
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

