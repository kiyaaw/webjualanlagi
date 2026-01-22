<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
</head>
<body>
    HALAMAN PENGADUAN
    <form action="proses-pengaduan.php" method="POST">
      <div>
        <label for=""> NIS :</label> <br>
        <input type="text" name= "nis"/>
      </div>
      <div>
      <label for="">Kategori:</label> <br>
        <select name="kategori" id="pilihan">
            <option value="Kelas">Fasilitas Kelas</option>
            <option value="Lingkungan">Likungan</option>
            <option value="Sanitasi">Sanitasi</option>
            <option value="Lainnya">Lainnya</option>
        </select>
      </div>

      <div>
      <label for="">Lokasi:</label> <br>
        <input type="text" name= "lokasi"/>
      </div>
      <div>
      <label for="">Keterangan:</label> <br>
        <textarea name="keterangan"></textarea>
      </div>
      <button style0>KIRIM</button>
    </form>
</body>
</html>