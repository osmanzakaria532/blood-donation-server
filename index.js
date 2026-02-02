// ============================================
// Blood Donation Backend - Beginner Friendly
// ============================================

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const app = express();
const port = process.env.PORT || 5000;

// MiddleWare
app.use(express.json());
app.use(cors());

const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.daqctd4.mongodb.net/?appName=Cluster0`;

const admin = require('firebase-admin');
// const serviceAccount = require('./blood-donation-firebase-adminsdk.json');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.get('/', (req, res) => {
  res.send('Blood Donation Server is Running!');
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const db = client.db('blood_donation_db');
    const userCollection = db.collection('users');

    // user related apis
    app.get('/users', async (req, res) => {
      const { email, search } = req.query;
      const query = {};
      if (email) {
        query.email = email;
      }

      // search functionality
      // if (search) {
      //   // query.displayName = search;
      //   query.$or = [
      //     { displayName: { $regex: search, $options: 'i' } },
      //     { email: { $regex: search, $options: 'i' } },
      //     { role: { $regex: search, $options: 'i' } },
      //   ];
      // }

      // সব user fetch
      const users = await userCollection.find(query).toArray();

      // const sortedUsers = users.sort((a, b) => {
      //   if (a.email === 'osmanzakaria801@gmail.com') return -1; // top
      //   if (b.email === 'osmanzakaria801@gmail.com') return 1;
      //   // others createdAt descending
      //   return new Date(b.createdAt) - new Date(a.createdAt);
      // });
      res.send(users);
    });

    app.post('/users', async (req, res) => {
      console.log('User API hit', req.body); // 👈 add this
      const user = req.body;
      user.role = 'user';
      user.createdAt = new Date();

      const email = user.email;
      const userExists = await userCollection.findOne({ email });
      if (userExists) {
        return res.send({ message: 'user already exists' });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. You successfully connected to MongoDB!');
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
