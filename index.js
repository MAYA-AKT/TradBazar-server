const { MongoClient, ServerApiVersion, ObjectId, Timestamp } = require('mongodb');
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config();




const app = express();
const port = process.env.PORT || 3000;


// Middleware
app.use(cors());
app.use(express.json());







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
        app.get("/user/role", async (req, res) => {
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
        app.post("/categories", async (req, res) => {
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
        app.put("/category/:id", async (req, res) => {
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
        app.delete('/category/:id', async (req, res) => {
            try {

                const id = req.params.id;
                const filter = { _id: new ObjectId(id) };
                await categoriesCollection.deleteOne(filter);
                res.status(200).json({ message: "Category deleted successfully" });

            } catch (error) {
                console.log("error on delete parcel", error);
                res.status(500).send({ message: "faild to delete Parcel" });
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

