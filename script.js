document.addEventListener('DOMContentLoaded', function() {
    const gallery = document.querySelector('.gallery');
    
    gallery.addEventListener('click', function(e) {
        const card = e.target.closest('.card');
        if (card) {
            e.preventDefault();
            e.stopPropagation();
            const img = card.querySelector('img');
            if (img) {
                const imageName = img.getAttribute('data-image');
                if (imageName) {
                    window.location.href = 'image.html?name=' + encodeURIComponent(imageName);
                }
            }
        }
    });
    
    document.documentElement.dataset.ready = "true";
});
