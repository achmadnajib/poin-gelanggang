# POIN GELANGGANG

Sistem penilaian pencak silat lokal real-time untuk operator, tiga juri, dan layar besar.

## Menjalankan

1. Jalankan `npm start`.
2. Buka `http://localhost:3000/operator` pada laptop operator.
3. Perangkat lain pada Wi-Fi/LAN yang sama membuka `http://IP-LAPTOP:3000/juri` atau `/display`.
4. Atur `OPERATOR_USERNAME` dan `OPERATOR_PASSWORD` melalui environment variable. Jangan simpan password di repository.

Kode akses juri awal mengikuti format `KODEPERTANDINGAN-NOMORJURI`, misalnya `123456-1`. Ganti `SESSION_SECRET` pada lingkungan produksi dan ubah password awal di `data/database.json` melalui hash bcrypt.

Data disimpan persisten di `data/database.json` menggunakan penulisan atomik. Riwayat yang dibatalkan tetap tersimpan dengan status `dibatalkan`.
