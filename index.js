// ============================================
// Blood Donation Backend - Beginner Friendly
// ============================================
const dns = require('dns');
dns.setServers(['1.1.1.1', '1.0.0.1']); // Use Cloudflare DNS

const express = require('express');
const cors = require('cors');
require('dotenv').config();
const Stripe = require('stripe');

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

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

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
    const donationRequestCollection = db.collection('donationRequest');
    const fundingCollection = db.collection('funding');

    // normalize user status values
    const normalizeUserStatus = (status) => {
      if (!status) return 'active';
      if (status === 'block') return 'blocked';
      return status;
    };

    const getUserRoleByEmail = async (email) => {
      if (!email) return null;
      const user = await usersCollection.findOne({ email });
      return user?.role || 'donor';
    };

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
        const normalized = users.map((u) => ({
          ...u,
          status: normalizeUserStatus(u.status),
        }));

        // Optional: log fetch action
        await actionLogs({
          actionType: 'fetch_users',
          userEmail: email || 'all',
          description: `Fetched users with search query: ${search || 'none'}`,
        });

        res.send(normalized);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error fetching users' });
      }
    });

    // Public donors search
    app.get('/donors', async (req, res) => {
      try {
        const { bloodGroup, district, upazila } = req.query;
        const query = { role: 'donor', status: 'active' };

        if (bloodGroup) query.bloodGroup = bloodGroup.toLowerCase();
        if (district) query.district = district.toLowerCase();
        if (upazila) query.upazila = upazila.toLowerCase();

        const donors = await usersCollection.find(query).toArray();
        res.send(donors);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to search donors' });
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

        const normalizedStatus = normalizeUserStatus(status);
        const allowedStatuses = ['active', 'blocked'];
        if (!allowedStatuses.includes(normalizedStatus)) {
          return res.status(400).send({ message: 'Invalid status' });
        }

        const query = { _id: new ObjectId(id) };
        const updateDoc = { $set: { status: normalizedStatus, updatedAt: new Date() } };

        await usersCollection.updateOne(query, updateDoc);

        const user = await getUserById(id);
        await actionLogs({
          actionType: 'update_status',
          userEmail: user.email,
          description: `Status changed to ${normalizedStatus}`,
        });

        res.send({ message: 'Status updated' });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error updating status' });
      }
    });

    // One-time normalization for existing users (block -> blocked)
    app.patch('/admin/normalize-user-status', async (req, res) => {
      try {
        const result = await usersCollection.updateMany(
          { status: 'block' },
          { $set: { status: 'blocked', updatedAt: new Date() } },
        );
        res.send({
          message: 'User status normalized',
          matchedCount: result.matchedCount,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to normalize user status' });
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

    app.patch('/users/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const allowedFields = ['displayName', 'bloodGroup', 'district', 'upazila', 'photoURL'];
        const updateFields = {};

        allowedFields.forEach((field) => {
          if (req.body[field] !== undefined) {
            updateFields[field] = req.body[field];
          }
        });

        if (Object.keys(updateFields).length === 0) {
          return res.status(400).send({ message: 'No valid profile fields provided' });
        }

        updateFields.updatedAt = new Date();

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields },
        );

        const user = await getUserById(id);
        await actionLogs({
          actionType: 'update_profile',
          userEmail: user?.email || 'unknown',
          description: 'Profile information updated',
          performedBy: user?.email || 'unknown',
        });

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error updating profile' });
      }
    });

    // Admin stats
    app.get('/admin-stats', async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalDonationRequests = await donationRequestCollection.countDocuments();

        const fundingAgg = await fundingCollection
          .aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }])
          .toArray();
        const totalFunding = fundingAgg[0]?.total || 0;

        res.send({
          totalUsers,
          totalDonationRequests,
          totalFunding,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to load admin stats' });
      }
    });

    // Funding APIs
    app.get('/fundings', async (req, res) => {
      try {
        const result = await fundingCollection.find().sort({ fundedAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to load fundings' });
      }
    });

    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { amount } = req.body;
        const numericAmount = Number(amount);

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).send({ message: 'Stripe secret key is not configured' });
        }

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
          return res.status(400).send({ message: 'Valid amount is required' });
        }

        const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(numericAmount * 100),
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to create payment intent' });
      }
    });

    app.post('/fundings', async (req, res) => {
      try {
        const { userName, userEmail, amount, transactionId } = req.body;
        const numericAmount = Number(amount);

        if (!userEmail || !transactionId || !Number.isFinite(numericAmount) || numericAmount <= 0) {
          return res.status(400).send({ message: 'Funding information is incomplete' });
        }

        const existingFunding = await fundingCollection.findOne({ transactionId });
        if (existingFunding) {
          return res.send(existingFunding);
        }

        const funding = {
          userName: userName || 'Anonymous Donor',
          userEmail,
          amount: numericAmount,
          transactionId,
          fundedAt: new Date(),
        };

        const result = await fundingCollection.insertOne(funding);
        await actionLogs({
          actionType: 'create_funding',
          userEmail,
          description: `Funding received: ${numericAmount}`,
          performedBy: userEmail,
        });

        res.send({ ...result, funding });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to save funding' });
      }
    });

    // ---------- Volunteer / Donor APIs ----------
    // TODO: Apply same structure + actionLogs + try-catch + validation

    // GET donation requests by user email
    app.get('/donationRequest', async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const result = await donationRequestCollection
          .find({ requesterEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to get donation requests' });
      }
    });

    // GET recent donation requests by user email
    app.get('/donationRequest/recent', async (req, res) => {
      try {
        const { email, limit = 3 } = req.query;

        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const take = Math.max(1, Math.min(Number(limit) || 3, 10));
        const result = await donationRequestCollection
          .find({ requesterEmail: email })
          .sort({ createdAt: -1 })
          .limit(take)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to get recent donation requests' });
      }
    });

    // GET all donation requests (admin/volunteer)
    app.get('/donationRequest/all', async (req, res) => {
      try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const result = await donationRequestCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to get donation requests' });
      }
    });

    // GET all pending donation requests (public)
    app.get('/donationRequest/pending', async (req, res) => {
      try {
        const result = await donationRequestCollection.find({ status: 'pending' }).toArray();
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to get pending donation requests' });
      }
    });

    // POST donation request
    app.post('/donationRequest', async (req, res) => {
      try {
        const donationRequest = req.body;
        donationRequest.status = 'pending';
        donationRequest.createdAt = new Date();

        const result = await donationRequestCollection.insertOne(donationRequest);
        await actionLogs({
          actionType: 'create_donation_request',
          userEmail: donationRequest.email,
          description: 'New donation request created',
        });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Error creating donation request' });
      }
    });

    // GET donation request by id
    app.get('/donationRequest/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const result = await donationRequestCollection.findOne({ _id: new ObjectId(id) });
        if (!result) {
          return res.status(404).send({ message: 'Donation request not found' });
        }
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to get donation request' });
      }
    });

    // PATCH donation request status + donor info
    app.patch('/donationRequest/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { status, donorName, donorEmail } = req.body;
        const actorEmail = req.headers['x-user-email'] || req.body.actorEmail;

        if (!actorEmail) {
          return res.status(401).send({ message: 'Actor email is required' });
        }

        const actorRole = await getUserRoleByEmail(actorEmail);
        if (actorRole === 'volunteer' && (donorName || donorEmail)) {
          return res.status(403).send({ message: 'Volunteer cannot update donor info' });
        }

        if (!status) {
          return res.status(400).send({ message: 'Status is required' });
        }

        const updateDoc = {
          $set: {
            status,
            donorName: donorName || null,
            donorEmail: donorEmail || null,
            updatedAt: new Date(),
          },
        };

        const result = await donationRequestCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc,
        );

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to update donation request' });
      }
    });

    // UPDATE donation request (editable fields)
    app.put('/donationRequest/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const actorEmail = req.headers['x-user-email'] || req.body.actorEmail;

        if (!actorEmail) {
          return res.status(401).send({ message: 'Actor email is required' });
        }

        const actorRole = await getUserRoleByEmail(actorEmail);
        if (actorRole === 'volunteer') {
          return res.status(403).send({ message: 'Volunteer cannot edit donation requests' });
        }

        const {
          recipientName,
          recipientBloodGroup,
          recipientDivision,
          recipientDistrict,
          recipientUpazila,
          hospitalName,
          recipientAddress,
          donationDate,
          donationTime,
          message,
        } = req.body;

        const updateDoc = {
          $set: {
            recipientName,
            recipientBloodGroup,
            recipientDivision,
            recipientDistrict,
            recipientUpazila,
            hospitalName,
            recipientAddress,
            donationDate,
            donationTime,
            message: message || '',
            updatedAt: new Date(),
          },
        };

        const result = await donationRequestCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc,
        );
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to update donation request' });
      }
    });

    // DELETE donation request
    app.delete('/donationRequest/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const actorEmail = req.headers['x-user-email'] || req.query.email;

        if (!actorEmail) {
          return res.status(401).send({ message: 'Actor email is required' });
        }

        const actorRole = await getUserRoleByEmail(actorEmail);
        if (actorRole === 'volunteer') {
          return res.status(403).send({ message: 'Volunteer cannot delete donation requests' });
        }

        const result = await donationRequestCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to delete donation request' });
      }
    });

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
// module.exports = app;
