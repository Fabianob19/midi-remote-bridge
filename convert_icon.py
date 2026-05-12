from PIL import Image

img_path = r'C:\Users\T-Gamer\.gemini\antigravity\brain\866f7b4b-a759-42f3-bb0e-06a2c6da1fb3\usbremoto_icon_v2_1777787667997.png'
img = Image.open(img_path).convert("RGBA")

# Auto-crop the black padding to make the icon as large as possible
# Convert to grayscale to find bounding box of non-black pixels
gray = img.convert("L")
# Threshold: anything brighter than 10 is considered "content"
bw = gray.point(lambda x: 0 if x < 20 else 255)
bbox = bw.getbbox()

if bbox:
    img = img.crop(bbox)

# Resize to max 256x256, keeping aspect ratio by adding transparent padding if needed
# Actually, for an icon, it's better to force a square aspect ratio first
size = max(img.size)
square_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
# Paste the cropped image in the center
offset = ((size - img.size[0]) // 2, (size - img.size[1]) // 2)
square_img.paste(img, offset)

# Now resize down to icon sizes
square_img = square_img.resize((256, 256), Image.Resampling.LANCZOS)
square_img.save(r'f:\usb-remoto\assets\icon.ico', format='ICO', sizes=[(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)])
print('Cropped and converted successfully!')
