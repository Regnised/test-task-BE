import express from 'express';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import winston from 'winston';
import expressWinston from 'express-winston';
import cors from 'cors';

const port = process.env.PORT || 3001;
const app = express();
app.use(express.json());
app.use(cors())
app.use(expressWinston.logger({
    transports: [
      new winston.transports.Console()
    ],
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.json()
    ),
    meta: true, // optional: control whether you want to log the meta data about the request (default to true)
    msg: "HTTP {{req.method}} {{req.url}}", // optional: customize the default logging message. E.g. "{{res.statusCode}} {{req.method}} {{res.responseTime}}ms {{req.url}}"
    expressFormat: true, // Use the default Express/morgan request formatting. Enabling this will override any msg if true. Will only output colors with colorize set to true
    colorize: false, // Color the text and status code, using the Express/morgan color palette (text: gray, status: default green, 3XX cyan, 4XX yellow, 5XX red).
    ignoreRoute: function (req, res) { return false; } // optional: allows to skip some log messages based on request and/or response
  }));

// TODO: move secrets to env variables
const SECRET_KEY = 'your_secret_key';

// TODO: move secrets to env variables
mongoose.connect('mongodb+srv://root:YT9LvXkjzHuYmvyD@cluster0.t5sp9.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');

// Schemas & Models
const userSchema = new mongoose.Schema({
  id: { type: String, default: uuidv4, unique: true },
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  balance: { type: mongoose.Types.Decimal128, default: 100 },
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
    if (!token) return res.status(401).json({ error: 'Access denied. Provide token' });
  
    try {
      const verified = jwt.verify(token.replace('Bearer ', ''), SECRET_KEY);
      req.userId = verified.userId;
      next();
    } catch (error) {
      res.status(400).json({ error: 'Invalid token' });
    }
};

  // Rate Limiter Middleware
const rateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each user to 10 requests per minute
    keyGenerator: (req) => req.userId || req.ip,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests, please try again later' }),
});

// Get Products
app.get('/products', async (req, res) => {
    try {
      const products = await Product.find();
      res.json(products);
    } catch (error) {
      logger.error('Error retrieving products', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

// Create an Order with User Creation & Token
app.post('/orders', rateLimiter, async (req, res) => {
  let { name, email, productId, quantity } = req.body;
  quantity = +quantity;
  try {
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ name, email });
      await user.save();
    }
    
    const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '1d' });
    
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
app.get('/orders/me', authenticateToken, rateLimiter, async (req, res) => {
  try {
    const orders = await Order.find({userId: req.userId});
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => console.log('Server running on port ' + port));
