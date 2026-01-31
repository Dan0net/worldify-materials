# Worldify Materials

PBR material bundler for Worldify. Compiles source textures into optimized DataArrayTexture binaries and manages storage on Cloudflare R2.

## Initial Setup

### 1. Create Cloudflare R2 Bucket

1. Go to https://dash.cloudflare.com → R2 Object Storage
2. Create bucket named `worldify-materials`
3. Go to bucket Settings → Public Access → Enable (for binaries)
4. Go to R2 → Manage R2 API Tokens → Create API Token
   - Permissions: Object Read & Write
   - Specify bucket: `worldify-materials`
5. Copy the Account ID, Access Key ID, and Secret Access Key

### 2. Configure Environment

```bash
cd ~/worldify-materials
cp .env.example .env
```

Edit `.env` with your R2 credentials:
```
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key
R2_SECRET_ACCESS_KEY=your_secret_key
R2_BUCKET=worldify-materials
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Upload Source Textures (One-time)

Copy source textures from worldify-app and upload to R2:
```bash
cp -r ~/worldify-app/material_bundler/materials/* ./sources/
npm run upload:sources
```

This uploads ~700MB of source PBR textures to R2. After this, you can delete `./sources/` locally - it will be downloaded on-demand.

### 5. Build and Upload Binaries

```bash
npm run build      # Generates low + high res binaries
npm run upload     # Uploads to R2 as v1
```

## Usage

| Command | Description |
|---------|-------------|
| `npm run download-sources` | Download source PBR textures from R2 |
| `npm run build` | Build both low and high resolution binaries |
| `npm run build:low` | Build only low-res (128×128) binaries |
| `npm run build:high` | Build only high-res (1024×1024) binaries |
| `npm run upload` | Upload binaries to R2 |
| `npm run upload:sources` | Upload source textures to R2 |

## Directory Structure

```
sources/           # Raw PBR textures (git-ignored, from R2)
  grass/
    albedo.png
    normal.png
    ao.png
    roughness.png
  ...

output/            # Generated binaries (git-ignored)
  low/
    albedo.bin
    normal.bin
    ...
  high/
    ...
  pallet.json

config/
  materials.json   # Material definitions
```

## Adding New Materials

1. Add texture files to `sources/{material_name}/`
2. Add entry to `config/materials.json`
3. Run `npm run build`
4. Run `npm run upload`

## R2 Bucket Structure

```
worldify-materials/
  sources/          # Raw textures (~700 MB)
  binaries/
    v1/             # Versioned releases
      pallet.json
      low/
      high/
```
