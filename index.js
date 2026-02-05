// ============================================
// Blood Donation Backend - Beginner Friendly
// ============================================
const dns = require('dns');
dns.setServers(['1.1.1.1', '1.0.0.1']); // Use Cloudflare DNS

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(express.json());
// app.use(cors());

const allowedOrigin = process.env.CLIENT_URL;
app.use(
  cors({
    origin: (origin, callback) => {
      // allow Postman / server requests
      if (!origin) return callback(null, true);
      // allow any localhost port
      if (origin.includes('localhost')) {
        return callback(null, true);
      }
      // allow production frontend
      if (origin === allowedOrigin) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }),
);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.daqctd4.mongodb.net/?appName=Cluster0`;

const admin = require('firebase-admin');
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.get('/', (req, res) => {
  res.send('Blood Donation Server is Running!');
});

// MongoDB client
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db('blood_donation_db');
    const usersCollection = db.collection('users');
    const volunteersCollection = db.collection('volunteers');
    const donorsCollection = db.collection('donors');
    const logsCollection = db.collection('logs');

    // function for logging
    const actionLogs = async ({ actionType, userEmail, description, performedBy = 'system' }) => {
      const log = {
        actionType,
        userEmail,
        description,
        performedBy,
        timestamp: new Date(),
      };
      await logsCollection.insertOne(log);
    };

    // function to fetch user by ID
    const getUserById = async (id) => {
      return usersCollection.findOne({ _id: new ObjectId(id) });
    };

    // User APIs
    app.get('/users', async (req, res) => {
      try {
        const { email, search } = req.query;
        const query = {};
        if (email) query.email = email;

        // Optional search functionality
        if (search) {
          query.$or = [
            { displayName: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { role: { $regex: search, $options: 'i' } },
          ];
        }

        const users = await usersCollection.find(query).toArray();

        // Optional: log fetch action
        await actionLogs({
          actionType: 'fetch_users',
          userEmail: email || 'all',
          description: `Fetched users with search query: ${search || 'none'}`,
        });

        res.send(users);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error fetching users' });
      }
    });

    app.get('/users/:email/role', async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        await actionLogs({
          actionType: 'fetch_role',
          userEmail: email,
          description: 'Role information requested',
        });
        res.send({ role: user?.role || 'donor' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error fetching role' });
      }
    });

    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
        user.role = 'donor';
        user.status = 'active';
        user.createdAt = new Date();

        const email = user.email;
        const userExists = await usersCollection.findOne({ email });

        if (userExists) {
          await actionLogs({
            actionType: 'create_user_failed',
            userEmail: email,
            description: 'User already exists',
          });
          return res.status(400).send({ message: 'User already exists' });
        }

        const result = await usersCollection.insertOne(user);

        await actionLogs({
          actionType: 'create_user',
          userEmail: email,
          description: 'New user created',
        });

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error creating user' });
      }
    });

    app.patch('/users/:id/status', async (req, res) => {
      try {
        const { status } = req.body;
        const { id } = req.params;

        if (!status) return res.status(400).send({ message: 'Invalid status' });

        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status, updatedAt: new Date() } };

        await usersCollection.updateOne(query, updateDoc);

        const user = await getUserById(id);
        await actionLogs({
          actionType: 'update_status',
          userEmail: user.email,
          description: `Status changed to ${status}`,
        });

        res.send({ message: 'Status updated' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error updating status' });
      }
    });

    app.patch('/users/:id/role', async (req, res) => {
      try {
        const { role } = req.body;
        const { id } = req.params;

        if (!role) {
          await actionLogs({
            actionType: 'update_role_failed',
            userEmail: 'unknown',
            description: `Invalid role attempted for user ID ${id}`,
          });
          return res.status(400).send({ message: 'Invalid role' });
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { role, updatedAt: new Date() } };

        await usersCollection.updateOne(query, updateDoc);

        const user = await getUserById(id);
        await actionLogs({
          actionType: 'update_role',
          userEmail: user.email,
          description: `Role changed to ${role}`,
        });

        res.send({ message: 'Role updated' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error updating role' });
      }
    });

    // ---------- Volunteer / Donor APIs ----------
    // TODO: Apply same structure + actionLogs + try-catch + validation

    await client.db('admin').command({ ping: 1 });
    console.log('Pinged your deployment. Successfully connected to MongoDB!');
  } finally {
    // Optional: client.close();
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
