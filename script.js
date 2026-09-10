document.addEventListener('DOMContentLoaded', function() {
    const gallery = document.querySelector('.gallery');
    
    gallery.addEventListener('click', function(e) {
        const img = e.target.closest('img');
        if (img) {
            e.preventDefault();
            e.stopPropagation();
            const imageName = img.getAttribute('data-image');
            if (imageName) {
                window.location.href = 'image.html?name=' + encodeURIComponent(imageName);
            }
        }
    });
});
document.documentElement.dataset.ready = "true";
