document.addEventListener('DOMContentLoaded', function() {
    const gallery = document.querySelector('.gallery');
    
    gallery.addEventListener('click', function(e) {
        const img = e.target.closest('img');
        if (img) {
            const imageName = img.getAttribute('data-image');
            if (imageName) {
                const imageId = imageName.replace(/\D/g, '');
                window.location.href = 'image.html?name=' + encodeURIComponent(imageName);
            }
        }
    });
});
document.documentElement.dataset.ready = "true";
