/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./**/*.php",              // সব PHP ফাইল স্ক্যান করবে
    "./src/**/*.{js,vue,ts}",  // src ফোল্ডারের সব JS/Vue ফাইল
    "./includes/**/*.php"      // includes ফোল্ডার (যদি থাকে)
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}