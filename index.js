import express from 'express';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const port = process.env.PORT || 3000;
const app = express();
app.use(express.json());

// TODO: move secrets to env variables
const SECRET_KEY = 'your_secret_key';

// TODO: move secrets to env variables
mongoose.connect('mongodb+srv://root:YT9LvXkjzHuYmvyD@cluster0.t5sp9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Schemas & Models
const userSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  balance: { type: mongoose.Types.Decimal128, default: 100 },
  token: { type: String },
});
const User = mongoose.model('User', userSchema);

const productSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  name: { type: String, required: true },
  price: { type: mongoose.Types.Decimal128, required: true },
  stock: { type: Number, required: true },
});
const Product = mongoose.model('Product', productSchema);

const orderSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  userId: { type: String, required: true, ref: 'User' },
  productId: { type: String, required: true, ref: 'Product' },
  quantity: { type: Number, required: true },
  totalPrice: { type: mongoose.Types.Decimal128, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Order = mongoose.model('Order', orderSchema);

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ error: 'Access denied' });
  
    try {
      const verified = jwt.verify(token.replace('Bearer ', ''), SECRET_KEY);
      req.userId = verified.userId;
      next();
    } catch (error) {
      res.status(400).json({ error: 'Invalid token' });
    }
  };

// Create an Order with User Creation & Token
app.post('/orders', async (req, res) => {
  const { name, email, productId, quantity } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ name, email });
      await user.save();
    }
    
    const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '1d' });
    user.token = token;
    await user.save();
    
    const product = await Product.findOne({ id: productId });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.stock < quantity) return res.status(400).json({ error: 'Not enough stock' });
    
    const totalPrice = product.price * quantity;
    if (user.balance < totalPrice) return res.status(400).json({ error: 'Insufficient balance' });
    
    // Transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      user.balance -= totalPrice;
      product.stock -= quantity;
      await user.save({ session });
      await product.save({ session });
      const order = new Order({ userId: user.id, productId, quantity, totalPrice });
      await order.save({ session });
      await session.commitTransaction();
      session.endSession();
      res.status(201).json({ user, token, order });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Retrieve a User’s Orders (with token validation)
app.get('/orders/:userId', authenticateToken, async (req, res) => {
  try {
    const orders = await Order.find({ userId: req.params.userId });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dummy products data
// Create 10 Products
app.post('/products/generate', async (req, res) => {
    try {
      const products = Array.from({ length: 10 }).map(() => ({
        name: `Product-${uuidv4().slice(0, 6)}`,
        price: Math.floor(Math.random() * (100 - 50 + 1)) + 50,
        stock: Math.floor(Math.random() * 100) + 1,
      }));
      
      await Product.insertMany(products);
      res.status(201).json({ message: '10 products created', products });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

// Start Server
app.listen(port, () => console.log('Server running on port 3000'));
