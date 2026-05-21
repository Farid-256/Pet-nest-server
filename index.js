const express = require('express')
const dotenv = require('dotenv')
const cors = require('cors')
dotenv.config()
const app = express()
const port = process.env.PORT
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs')
const uri = process.env.MONGODB_URI

app.use(cors())
app.use(express.json())

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
})

const JWKS = createRemoteJWKSet(
    new URL('http://localhost:3000/api/auth/jwks')
)

const verifyToken = async(req, res, next) => {
    const authHeader = req?.headers.authorization
    if (!authHeader) {
        return res.status(401).json({ message: 'Unauthorized' })
    }
    const token = authHeader.split(' ')[1]
    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    try {
        const { payload } = await jwtVerify(token, JWKS)
        next()
        
    } catch (error) {
        return res.status(403).json({message: 'Forbidden'})
    }

}

async function run() {
    try {
        await client.connect()
        const db = client.db('adopMe')
        const animalsCollection = db.collection('animals')
        const adoptingCollection = db.collection('adopCollection')

        app.post('/animals', verifyToken, async (req, res) => {
            const newPet = req.body
            const result = await animalsCollection.insertOne(newPet)
            res.send(result)
        })

        app.get('/animals',async (req, res) => {
            try {

                const search = req.query.search || '';
                const species = req.query.species || '';
                const sort = req.query.sort || '';

                const limit = req.query.limit
                    ? parseInt(req.query.limit)
                    : 0;

                const query = {};

               
                if (search) {
                    query.name = {
                        $regex: search,
                        $options: 'i'
                    };
                }

                if (species) {

                    const speciesArray = species.split(',');

                    query.species = {
                        $in: speciesArray
                    };
                }

                let sortOption = {};

                if (sort === 'low') {
                    sortOption = { adoptionFee: 1 };
                }

                if (sort === 'high') {
                    sortOption = { adoptionFee: -1 };
                }

                const result = await animalsCollection
                    .find(query)
                    .sort(sortOption)
                    .limit(limit)
                    .toArray();

                res.send(result);

            } catch (error) {
                console.log(error);
                res.status(500).send({
                    error: "Server Error"
                });
            }
        });

        app.get('/animals/:id', verifyToken, async (req, res) => {
            const id = req.params.id
            const query = {
                _id: new ObjectId(id)
            }
            const animal = await animalsCollection.findOne(query)
            res.send(animal)
        })

        app.get('/my-listings',verifyToken, async (req, res) => {
            try {
                const userEmail = req.query.email;

                const result = await animalsCollection.find({
                    ownerEmail: userEmail
                }).toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Server Error" });
            }
        })

        app.get('/requests/:petId', async (req, res) => {
            try {
                const { petId } = req.params;
                const requests = await adoptingCollection.find({
                    animalId: petId
                }).toArray();

                res.send(requests);
            } catch (error) {
                console.error(error);
                res.status(500).send({ error: "Server Error" });
            }
        })

        app.get('/my-requests',verifyToken, async (req, res) => {
            try {
                const userEmail = req.query.email;

                const result = await adoptingCollection.find({
                    userEmail: userEmail
                }).toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Server Error" });
            }
        })



        app.post('/adoptions',verifyToken, async (req, res) => {
            try {
                const adopingData = req.body;

                if (adopingData.userEmail === adopingData.ownerEmail) {
                    return res.status(400).send({ error: "You cannot adopt your own pet" });
                }

                const result = await adoptingCollection.insertOne(adopingData);
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Server Error" });
            }
        });

        app.patch('/animals/:id', verifyToken, async (req, res) => {
            const { id } = req.params
            const upDatedData = req.body
            const result = await animalsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: upDatedData }
            )
            res.send(result)
        })


        // Approve Request
        app.patch('/requests/approve/:requestId',verifyToken, async (req, res) => {
            try {
                const { requestId } = req.params;

                const request = await adoptingCollection.findOne({ _id: new ObjectId(requestId) });

                if (!request) {
                    return res.status(404).send({ error: "Request not found" });
                }

                // 1. Approve this request
                await adoptingCollection.updateOne(
                    { _id: new ObjectId(requestId) },
                    { $set: { status: 'approved' } }
                );

                // 2. Mark pet as adopted
                await animalsCollection.updateOne(
                    { _id: new ObjectId(request.animalId) },
                    { $set: { status: 'adopted' } }
                );

                // 3. Reject all other requests for this pet
                await adoptingCollection.updateMany(
                    {
                        animalId: request.animalId,
                        _id: { $ne: new ObjectId(requestId) },   // এই রিকোয়েস্ট বাদে
                        status: 'pending'
                    },
                    { $set: { status: 'rejected' } }
                );

                res.send({ success: true, message: "Request Approved & others rejected" });
            } catch (error) {
                console.error(error);
                res.status(500).send({ error: "Server Error" });
            }
        })

        // Reject Request
        app.patch('/requests/reject/:requestId', verifyToken, async (req, res) => {
            try {
                const { requestId } = req.params;

                await adoptingCollection.updateOne(
                    { _id: new ObjectId(requestId) },
                    { $set: { status: 'rejected' } }
                );

                res.send({ success: true, message: "Request Rejected" });
            } catch (error) {
                console.error(error);
                res.status(500).send({ error: "Server Error" });
            }
        });



        app.delete('/my-listings/:id',verifyToken, async (req, res) => {
            const id = req.params.id
            const query = {
                _id: new ObjectId(id)
            }
            const result = await animalsCollection.deleteOne(query)
            res.send(result)
        })

        app.delete('/adoptions/:id', verifyToken, async (req, res) => {
            try {
                const { id } = req.params;
                const result = await adoptingCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Server Error" });
            }
        })




        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {

    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Hello form express')
})

app.listen(port, () => {
    console.log(`App listening on port: ${port}`)
})