# LifeStream (Server)

## Project Purpose
LifeStream server হলো blood donation অ্যাপের backend API। এখানে user management, role/status update, এবং donation request সম্পর্কিত সব ডাটা সংরক্ষণ ও প্রসেস করা হয়। এই সার্ভার MongoDB ডাটাবেজ এবং Firebase Admin ব্যবহার করে নিরাপদভাবে ডাটা ম্যানেজ করে।

## Live URL
TBA

## Key Features
- User তৈরি, role update, status (active/blocked) update API
- Donation request তৈরি এবং fetch করার API
- MongoDB ডাটাবেজ ব্যবহার করে ডাটা স্টোরেজ
- Firebase Admin দিয়ে secure setup
- CORS configuration (production + localhost)

## NPM Packages Used
- bcryptjs
- cors
- dotenv
- express
- firebase-admin
- jsonwebtoken
- mongodb
- nodemon
